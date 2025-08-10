import { Message } from 'discord.js';
import { DatabaseManager, BotConfig, ModerationRule } from '../database/DatabaseManager.js';
import { OllamaManager } from '../ollama/OllamaManager.js';
import { Logger } from '../utils/Logger.js';
import { FastPassFilter, FastPassResult } from './filters/FastPassFilter.js';
import { RAGSystem, AIAnalysisResult } from './RAGSystem.js';
import { ModerationActions, ActionResult } from './actions/ModerationActions.js';

export interface ModerationResult {
  actionTaken: string;
  detectionType: 'fast_pass' | 'ai_analysis';
  ruleTriggered?: string;
  confidenceScores: {[key: string]: number};
  reasoning?: string;
  success: boolean;
  error?: string;
}

export class ModerationPipeline {
  private db: DatabaseManager;
  private ollama: OllamaManager;
  private logger: Logger;
  private fastPassFilter: FastPassFilter;
  private ragSystem: RAGSystem;
  private moderationActions: ModerationActions;
  private config?: BotConfig;
  private isInitialized = false;

  constructor(db: DatabaseManager, ollama: OllamaManager, logger: Logger) {
    this.db = db;
    this.ollama = ollama;
    this.logger = logger;
    this.fastPassFilter = new FastPassFilter(db, logger);
    this.ragSystem = new RAGSystem(db, ollama, logger);
    this.moderationActions = new ModerationActions(logger);
  }

  async initialize(config: BotConfig): Promise<void> {
    this.config = config;

    try {
      // Initialize fast pass filter
      await this.fastPassFilter.initialize(config);
      
      // Initialize RAG system
      await this.ragSystem.initialize(config);

      this.isInitialized = true;
      
      this.logger.info('Moderation pipeline initialized', {
        guildId: config.guild_id,
        model: config.selected_model,
        policyPackId: config.active_policy_pack_id
      });

    } catch (error) {
      this.logger.error('Failed to initialize moderation pipeline', { error: String(error) });
      throw error;
    }
  }

  async moderateMessage(message: Message): Promise<ModerationResult> {
    if (!this.isInitialized || !this.config) {
      return {
        actionTaken: 'none',
        detectionType: 'fast_pass',
        confidenceScores: {},
        success: false,
        error: 'Moderation pipeline not initialized'
      };
    }

    try {
      // Phase 1: Fast Pass Filter
      const fastPassResult = await this.runFastPass(message);
      
      if (fastPassResult.actionTaken !== 'none') {
        return fastPassResult;
      }

      // Phase 2: AI Analysis (if fast pass didn't trigger)
      const aiResult = await this.runAIAnalysis(message);
      
      return aiResult;

    } catch (error) {
      this.logger.error('Error in moderation pipeline', {
        messageId: message.id,
        error: String(error)
      });

      return {
        actionTaken: 'none',
        detectionType: 'fast_pass',
        confidenceScores: {},
        success: false,
        error: String(error)
      };
    }
  }

  private async runFastPass(message: Message): Promise<ModerationResult> {
    try {
      const result = await this.fastPassFilter.checkMessage(
        message.content,
        message.author.id,
        message.channelId
      );

      if (result.triggered) {
        // Execute the action
        const actionResult = await this.executeAction(
          message,
          result.action!,
          result.reason!
        );

        return {
          actionTaken: result.action!,
          detectionType: 'fast_pass',
          ruleTriggered: result.ruleTriggered,
          confidenceScores: { [result.ruleTriggered!]: result.confidence || 1.0 },
          reasoning: result.reason,
          success: actionResult.success,
          error: actionResult.error
        };
      }

      return {
        actionTaken: 'none',
        detectionType: 'fast_pass',
        confidenceScores: {},
        success: true
      };

    } catch (error) {
      this.logger.error('Fast pass filter error', {
        messageId: message.id,
        error: String(error)
      });

      return {
        actionTaken: 'none',
        detectionType: 'fast_pass',
        confidenceScores: {},
        success: false,
        error: String(error)
      };
    }
  }

  private async runAIAnalysis(message: Message): Promise<ModerationResult> {
    if (!this.config?.active_policy_pack_id) {
      return {
        actionTaken: 'none',
        detectionType: 'ai_analysis',
        confidenceScores: {},
        success: false,
        error: 'No active policy pack'
      };
    }

    try {
      // Get AI analysis
      const analysis = await this.ragSystem.analyzeMessage(
        message.content,
        message.author.id,
        message.channelId,
        this.config.active_policy_pack_id
      );

      // Get policy rules for action determination
      const policyRules = await this.db.getModerationRules(this.config.active_policy_pack_id);

      // Determine final action based on analysis and rules
      const actionDecision = await this.ragSystem.determineAction(analysis, policyRules);

      // Build confidence scores object
      const confidenceScores = {
        toxicity: analysis.toxicity,
        harassment: analysis.harassment,
        spam: analysis.spam,
        grooming: analysis.grooming,
        overall: analysis.confidence
      };

      if (actionDecision.action !== 'none') {
        // Execute the action
        const reasoning = this.ragSystem.generateExplanation(analysis, actionDecision.action);
        
        const actionResult = await this.executeAction(
          message,
          actionDecision.action,
          reasoning
        );

        return {
          actionTaken: actionDecision.action,
          detectionType: 'ai_analysis',
          ruleTriggered: actionDecision.ruleTriggered,
          confidenceScores,
          reasoning: reasoning,
          success: actionResult.success,
          error: actionResult.error
        };
      }

      return {
        actionTaken: 'none',
        detectionType: 'ai_analysis',
        confidenceScores,
        reasoning: analysis.reasoning,
        success: true
      };

    } catch (error) {
      this.logger.error('AI analysis error', {
        messageId: message.id,
        error: String(error)
      });

      return {
        actionTaken: 'none',
        detectionType: 'ai_analysis',
        confidenceScores: {},
        success: false,
        error: String(error)
      };
    }
  }

  private async executeAction(
    message: Message,
    action: string,
    reason: string
  ): Promise<ActionResult> {
    try {
      // Check if bot has required permissions
      const hasPermissions = await this.moderationActions.hasRequiredPermissions(message, action);
      
      if (!hasPermissions) {
        this.logger.warn('Insufficient permissions for moderation action', {
          action,
          messageId: message.id,
          guildId: message.guildId
        });

        return {
          success: false,
          action: action,
          error: 'Insufficient permissions to execute moderation action'
        };
      }

      // Execute the action
      const result = await this.moderationActions.executeAction(message, action, reason);

      if (result.success) {
        this.logger.info('Moderation action executed', {
          action,
          messageId: message.id,
          userId: message.author.id,
          reason
        });
      } else {
        this.logger.error('Moderation action failed', {
          action,
          messageId: message.id,
          error: result.error
        });
      }

      return result;

    } catch (error) {
      this.logger.error('Error executing moderation action', {
        action,
        messageId: message.id,
        error: String(error)
      });

      return {
        success: false,
        action: action,
        error: String(error)
      };
    }
  }

  // Method to reload configuration and reinitialize components
  async reload(config: BotConfig): Promise<void> {
    this.config = config;
    this.isInitialized = false;
    
    try {
      await this.initialize(config);
      this.logger.info('Moderation pipeline reloaded', { guildId: config.guild_id });
    } catch (error) {
      this.logger.error('Failed to reload moderation pipeline', { error: String(error) });
      throw error;
    }
  }

  // Health check method
  getHealthStatus(): {
    initialized: boolean;
    fastPassReady: boolean;
    aiReady: boolean;
    config?: BotConfig;
  } {
    return {
      initialized: this.isInitialized,
      fastPassReady: this.isInitialized,
      aiReady: this.isInitialized && Boolean(this.config?.selected_model),
      config: this.config
    };
  }

  // Method to get statistics
  async getStatistics(timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<{
    totalMessages: number;
    moderatedMessages: number;
    actionBreakdown: {[action: string]: number};
    detectionTypeBreakdown: {fast_pass: number, ai_analysis: number};
  }> {
    // This would query the database for moderation statistics
    // Implementation would depend on having timestamps in the moderation_logs table
    return {
      totalMessages: 0,
      moderatedMessages: 0,
      actionBreakdown: {},
      detectionTypeBreakdown: { fast_pass: 0, ai_analysis: 0 }
    };
  }
}