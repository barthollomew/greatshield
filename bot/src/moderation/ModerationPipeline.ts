import { Message } from 'discord.js';
import { DatabaseManager, BotConfig } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';
import { Logger } from '../utils/Logger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';
import { FastPassFilter } from './filters/FastPassFilter';
import { RAGSystem } from './RAGSystem';
import { ModerationActions, ActionResult } from './actions/ModerationActions';
import { IModerationPipeline, ModerationResult } from '../core/interfaces/IModerationPipeline';
import { InputValidator, ValidationResult } from '../security/InputValidator';
import { RateLimiter, RateLimitResult } from '../security/RateLimiter';
import { ContentSanitizer, SanitizationResult } from '../security/ContentSanitizer';
import { MonitoringService } from '../monitoring/MonitoringService';

// Internal result interface for backward compatibility
interface InternalModerationResult {
  actionTaken: string;
  detectionType: 'fast_pass' | 'ai_analysis';
  ruleTriggered?: string | undefined;
  confidenceScores: {[key: string]: number};
  reasoning?: string | undefined;
  success: boolean;
  error?: string | undefined;
}

export class ModerationPipeline implements IModerationPipeline {
  private db: DatabaseManager;
  private logger: Logger;
  private errorHandler?: ErrorHandler;
  private fastPassFilter: FastPassFilter;
  private ragSystem: RAGSystem;
  private moderationActions: ModerationActions;
  private inputValidator: InputValidator;
  private rateLimiter: RateLimiter;
  private contentSanitizer: ContentSanitizer;
  private monitoringService?: MonitoringService;
  private config?: BotConfig;
  private isInitialized = false;

  constructor(db: DatabaseManager, ollama: OllamaManager, logger: Logger) {
    this.db = db;
    this.logger = logger;
    
    // Get error handler from logger
    this.errorHandler = logger.getErrorHandler();
    
    this.fastPassFilter = new FastPassFilter(db, logger);
    this.ragSystem = new RAGSystem(db, ollama, logger);
    this.moderationActions = new ModerationActions(logger);
    this.inputValidator = new InputValidator(logger);
    this.rateLimiter = new RateLimiter(logger, db);
    this.contentSanitizer = new ContentSanitizer(logger);
    
    // Initialize monitoring service
    this.monitoringService = new MonitoringService(db, ollama, logger);
  }

  async initialize(config: BotConfig): Promise<void> {
    this.config = config;

    try {
      // Initialize fast pass filter
      await this.fastPassFilter.initialize(config);
      
      // Initialize RAG system
      await this.ragSystem.initialize(config);

      // Start monitoring service
      if (this.monitoringService) {
        await this.monitoringService.start();
      }

      this.isInitialized = true;
      
      this.logger.info('Moderation pipeline initialized', {
        guildId: config.guild_id,
        model: config.selected_model,
        policyPackId: config.active_policy_pack_id
      });

    } catch (error) {
      const structuredError = this.errorHandler?.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.UNKNOWN,
        ErrorSeverity.CRITICAL,
        {
          operation: 'initialize',
          component: 'moderation_pipeline',
          guildId: config.guild_id
        }
      );
      
      this.logger.error('Failed to initialize moderation pipeline', { 
        error: String(error),
        errorId: structuredError?.id
      });
      throw error;
    }
  }

  async moderateMessage(message: Message): Promise<ModerationResult | null> {
    if (!this.isInitialized || !this.config) {
      this.logger.error('Moderation pipeline not initialized');
      return null;
    }

    // Start overall processing timer
    this.monitoringService?.startPerformanceTimer('message_processing');
    const startTime = Date.now();

    try {
      // Record message processing
      this.monitoringService?.recordModerationEvent('message_processed');

      // Phase 0: Security validation and rate limiting
      this.monitoringService?.startPerformanceTimer('security_checks');
      const securityResult = await this.runSecurityChecks(message);
      const securityTime = this.monitoringService?.endPerformanceTimer('security_checks') || 0;
      
      if (securityResult.actionTaken !== 'none' && securityResult.success) {
        const totalTime = this.monitoringService?.endPerformanceTimer('message_processing') || 0;
        this.monitoringService?.recordModerationEvent('action_taken', totalTime, securityResult.actionTaken);
        return this.convertToInterfaceResult(securityResult);
      }

      // Phase 1: Fast Pass Filter
      this.monitoringService?.startPerformanceTimer('fast_pass');
      const fastPassResult = await this.runFastPass(message);
      const fastPassTime = this.monitoringService?.endPerformanceTimer('fast_pass') || 0;
      
      if (fastPassResult.actionTaken !== 'none' && fastPassResult.success) {
        const totalTime = this.monitoringService?.endPerformanceTimer('message_processing') || 0;
        this.monitoringService?.recordModerationEvent('fast_pass_hit', fastPassTime, fastPassResult.actionTaken);
        this.monitoringService?.recordModerationEvent('action_taken', totalTime, fastPassResult.actionTaken);
        return this.convertToInterfaceResult(fastPassResult);
      }

      // Phase 2: AI Analysis (if fast pass didn't trigger)
      this.monitoringService?.startPerformanceTimer('ai_analysis');
      const aiResult = await this.runAIAnalysis(message);
      const aiTime = this.monitoringService?.endPerformanceTimer('ai_analysis') || 0;
      
      if (aiResult.actionTaken !== 'none' && aiResult.success) {
        const totalTime = this.monitoringService?.endPerformanceTimer('message_processing') || 0;
        this.monitoringService?.recordModerationEvent('ai_analysis', aiTime);
        this.monitoringService?.recordModerationEvent('action_taken', totalTime, aiResult.actionTaken);
        return this.convertToInterfaceResult(aiResult);
      }

      // No action needed - record completion
      const totalTime = this.monitoringService?.endPerformanceTimer('message_processing') || 0;
      this.monitoringService?.recordModerationEvent('message_processed', totalTime);
      return null;

    } catch (error) {
      const totalTime = this.monitoringService?.endPerformanceTimer('message_processing') || 0;
      
      const structuredError = this.errorHandler?.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.UNKNOWN,
        ErrorSeverity.HIGH,
        {
          operation: 'moderate_message',
          component: 'moderation_pipeline',
          messageId: message.id,
          userId: message.author.id,
          guildId: message.guildId || undefined,
          channelId: message.channelId,
          metadata: { processingTime: totalTime }
        }
      );
      
      this.logger.error('Error in moderation pipeline', {
        messageId: message.id,
        error: String(error),
        processingTime: totalTime,
        errorId: structuredError?.id
      });

      // Record error metrics
      this.monitoringService?.recordSecurityEvent('security_threat', 'high', {
        type: 'pipeline_error',
        messageId: message.id,
        error: String(error),
        errorId: structuredError?.id
      });

      return null;
    }
  }

  private async runSecurityChecks(message: Message): Promise<InternalModerationResult> {
    try {
      // Step 1: Rate limiting check
      const rateLimitResult = await this.rateLimiter.checkMessageRateLimit(message);
      
      if (!rateLimitResult.allowed) {
        const action = this.determineRateLimitAction(rateLimitResult.penaltyLevel);
        
        // Record security event
        this.monitoringService?.recordSecurityEvent(
          'rate_limit_violation',
          this.getSeverityFromPenalty(rateLimitResult.penaltyLevel),
          {
            userId: message.author.id,
            channelId: message.channelId,
            penaltyLevel: rateLimitResult.penaltyLevel,
            action: action
          }
        );
        
        const actionResult = await this.executeAction(
          message,
          action,
          `Rate limit violation: ${rateLimitResult.reason}`
        );

        return {
          actionTaken: action,
          detectionType: 'fast_pass',
          ruleTriggered: 'rate_limit',
          confidenceScores: { rate_limit: 1.0 },
          reasoning: rateLimitResult.reason || 'Rate limit exceeded',
          success: actionResult.success,
          error: actionResult.error || undefined
        };
      }

      // Step 2: Input validation
      const validationResult = await this.inputValidator.validateMessage(message);
      
      if (!validationResult.isValid || validationResult.riskLevel === 'critical') {
        const action = this.determineValidationAction(validationResult.riskLevel);
        
        // Record security event
        this.monitoringService?.recordSecurityEvent(
          'blocked_message',
          validationResult.riskLevel as 'low' | 'medium' | 'high' | 'critical',
          {
            userId: message.author.id,
            channelId: message.channelId,
            errors: validationResult.errors.join(', '),
            action: action
          }
        );
        
        const actionResult = await this.executeAction(
          message,
          action,
          `Security validation failed: ${validationResult.errors.join(', ')}`
        );

        return {
          actionTaken: action,
          detectionType: 'fast_pass',
          ruleTriggered: 'security_validation',
          confidenceScores: { security: this.getRiskLevelScore(validationResult.riskLevel) },
          reasoning: `Security issues detected: ${validationResult.errors.join(', ')}`,
          success: actionResult.success,
          error: actionResult.error || undefined
        };
      }

      // Step 3: Content sanitization (high-risk content)
      if (validationResult.riskLevel === 'high') {
        const sanitizationResult = await this.contentSanitizer.sanitizeContent(
          message.content,
          message.author.id
        );

        if (sanitizationResult.riskLevel === 'critical' || sanitizationResult.blockedElements.length > 0) {
          const action = this.determineSanitizationAction(sanitizationResult.riskLevel);
          
          // Record security event
          this.monitoringService?.recordSecurityEvent(
            'sanitized_content',
            sanitizationResult.riskLevel as 'low' | 'medium' | 'high' | 'critical',
            {
              userId: message.author.id,
              channelId: message.channelId,
              blockedElements: sanitizationResult.blockedElements.join(', '),
              modifications: sanitizationResult.modificationsApplied.join(', '),
              action: action
            }
          );
          
          const actionResult = await this.executeAction(
            message,
            action,
            `Content sanitization triggered: ${sanitizationResult.modificationsApplied.join(', ')}`
          );

          return {
            actionTaken: action,
            detectionType: 'fast_pass',
            ruleTriggered: 'content_sanitization',
            confidenceScores: { sanitization: this.getRiskLevelScore(sanitizationResult.riskLevel) },
            reasoning: `Dangerous content patterns detected: ${sanitizationResult.blockedElements.join(', ')}`,
            success: actionResult.success,
            error: actionResult.error || undefined
          };
        }
      }

      // All security checks passed
      return {
        actionTaken: 'none',
        detectionType: 'fast_pass',
        confidenceScores: {},
        success: true
      };

    } catch (error) {
      this.logger.error('Security checks error', {
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

  private determineRateLimitAction(penaltyLevel: string): string {
    switch (penaltyLevel) {
      case 'warning': return 'warn';
      case 'temp_mute': return 'timeout';
      case 'temp_ban': return 'ban_temp';
      default: return 'delete';
    }
  }

  private determineValidationAction(riskLevel: string): string {
    switch (riskLevel) {
      case 'critical': return 'ban_temp';
      case 'high': return 'delete_warn';
      case 'medium': return 'delete';
      default: return 'none';
    }
  }

  private determineSanitizationAction(riskLevel: string): string {
    switch (riskLevel) {
      case 'critical': return 'ban_temp';
      case 'high': return 'delete_warn';
      case 'medium': return 'delete';
      default: return 'warn';
    }
  }

  private getRiskLevelScore(riskLevel: string): number {
    switch (riskLevel) {
      case 'critical': return 1.0;
      case 'high': return 0.8;
      case 'medium': return 0.6;
      case 'low': return 0.3;
      default: return 0.1;
    }
  }

  private getSeverityFromPenalty(penaltyLevel: string): 'low' | 'medium' | 'high' | 'critical' {
    switch (penaltyLevel) {
      case 'warning': return 'low';
      case 'temp_mute': return 'medium';
      case 'temp_ban': return 'high';
      default: return 'critical';
    }
  }

  private async runFastPass(message: Message): Promise<InternalModerationResult> {
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
          ruleTriggered: result.ruleTriggered!,
          confidenceScores: { [result.ruleTriggered!]: result.confidence || 1.0 },
          reasoning: result.reason || undefined,
          success: actionResult.success,
          error: actionResult.error || undefined
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

  private async runAIAnalysis(message: Message): Promise<InternalModerationResult> {
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
          ruleTriggered: actionDecision.ruleTriggered!,
          confidenceScores,
          reasoning: reasoning,
          success: actionResult.success,
          error: actionResult.error || undefined
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
      const result = await this.moderationActions.executeAction(action, message, reason);

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

  private convertToInterfaceResult(internal: InternalModerationResult): ModerationResult {
    return {
      action: internal.actionTaken,
      reason: internal.reasoning || 'No reason provided',
      confidence: internal.confidenceScores['overall'],
      ruleTriggered: internal.ruleTriggered,
      detectionType: internal.detectionType
    };
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
      config: this.config!
    };
  }

  // Method to get statistics
  async getStatistics(_timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<{
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

  // Method to get monitoring report
  async getMonitoringReport() {
    if (!this.monitoringService) {
      return null;
    }
    
    return await this.monitoringService.generateReport();
  }

  // Method to shutdown pipeline and cleanup resources
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down moderation pipeline');
    
    try {
      // Stop monitoring service
      if (this.monitoringService) {
        await this.monitoringService.stop();
      }
      
      this.isInitialized = false;
      
      this.logger.info('Moderation pipeline shutdown complete');
      
    } catch (error) {
      this.logger.error('Error during pipeline shutdown', { error: String(error) });
      throw error;
    }
  }
}