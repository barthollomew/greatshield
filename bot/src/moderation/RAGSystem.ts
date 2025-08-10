import { DatabaseManager, ModerationRule, BotConfig } from '../database/DatabaseManager.js';
import { OllamaManager, GenerateRequest } from '../ollama/OllamaManager.js';
import { Logger } from '../utils/Logger.js';

export interface RAGContext {
  recentMessages: Array<{user_id: string, content: string, timestamp: string}>;
  policyRules: ModerationRule[];
  currentMessage: {
    content: string;
    user_id: string;
    channel_id: string;
  };
}

export interface AIAnalysisResult {
  toxicity: number;
  harassment: number;
  spam: number;
  grooming: number;
  action: 'none' | 'mask' | 'delete_warn' | 'shadowban' | 'escalate';
  reasoning: string;
  confidence: number;
}

export class RAGSystem {
  private db: DatabaseManager;
  private ollama: OllamaManager;
  private logger: Logger;
  private selectedModel?: string;

  constructor(db: DatabaseManager, ollama: OllamaManager, logger: Logger) {
    this.db = db;
    this.ollama = ollama;
    this.logger = logger;
  }

  async initialize(config: BotConfig): Promise<void> {
    if (!config.selected_model) {
      throw new Error('No AI model configured');
    }

    this.selectedModel = config.selected_model;

    // Verify model is available
    const modelAvailable = await this.ollama.isModelAvailable(this.selectedModel);
    if (!modelAvailable) {
      throw new Error(`Model ${this.selectedModel} is not available. Please pull it first.`);
    }

    this.logger.info('RAG system initialized', {
      model: this.selectedModel
    });
  }

  async analyzeMessage(
    content: string,
    userId: string,
    channelId: string,
    policyPackId: number
  ): Promise<AIAnalysisResult> {
    if (!this.selectedModel) {
      throw new Error('RAG system not initialized');
    }

    // Gather context
    const context = await this.gatherContext(content, userId, channelId, policyPackId);

    // Generate prompt
    const prompt = await this.generatePrompt(context);

    // Query the model
    const response = await this.queryModel(prompt);

    // Parse response
    const analysis = await this.parseResponse(response);

    this.logger.debug('AI analysis completed', {
      messageLength: content.length,
      userId: userId,
      analysis: analysis
    });

    return analysis;
  }

  private async gatherContext(
    content: string,
    userId: string,
    channelId: string,
    policyPackId: number
  ): Promise<RAGContext> {
    // Get recent channel messages for context
    const recentMessages = await this.db.getRecentMessageContext(channelId, 10);

    // Get moderation rules for the policy pack
    const policyRules = await this.db.getModerationRules(policyPackId);

    return {
      recentMessages,
      policyRules,
      currentMessage: {
        content,
        user_id: userId,
        channel_id: channelId
      }
    };
  }

  private async generatePrompt(context: RAGContext): Promise<string> {
    // Build context summary
    const recentMessagesText = context.recentMessages
      .slice(-5) // Use only last 5 messages for context
      .map(msg => `User ${msg.user_id}: ${msg.content}`)
      .join('\n');

    // Build policy rules summary
    const rulesText = context.policyRules
      .map(rule => `${rule.rule_type}: threshold ${rule.threshold}, action ${rule.action}`)
      .join('\n');

    const prompt = `You are Greatshield, an AI content moderation system. Analyze the following Discord message for potential policy violations.

POLICY RULES:
${rulesText}

RECENT CHANNEL CONTEXT (for reference):
${recentMessagesText || 'No recent messages available'}

CURRENT MESSAGE TO ANALYZE:
User ${context.currentMessage.user_id}: ${context.currentMessage.content}

TASK:
Analyze the current message and provide scores (0.0 to 1.0) for:
1. toxicity - offensive, rude, or disrespectful language
2. harassment - targeting or bullying specific users
3. spam - repetitive, promotional, or off-topic content  
4. grooming - inappropriate advances or predatory behavior

Based on the policy rules and your analysis, recommend an action:
- none: message is acceptable
- mask: hide offensive parts but keep message
- delete_warn: delete message and warn user
- shadowban: prevent user from being seen by others
- escalate: alert moderators for manual review

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "toxicity": 0.0,
  "harassment": 0.0,
  "spam": 0.0,
  "grooming": 0.0,
  "action": "none",
  "reasoning": "Brief explanation of your decision",
  "confidence": 0.0
}

Consider context, intent, and severity. Be fair but firm in protecting the community.`;

    return prompt;
  }

  private async queryModel(prompt: string): Promise<string> {
    if (!this.selectedModel) {
      throw new Error('Model not selected');
    }

    const request: GenerateRequest = {
      model: this.selectedModel,
      prompt: prompt,
      format: 'json',
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for consistent analysis
        top_p: 0.9,
        max_tokens: 500
      }
    };

    const response = await this.ollama.generateText(request);
    return response.response;
  }

  private async parseResponse(response: string): Promise<AIAnalysisResult> {
    try {
      // Clean up response (remove any markdown formatting)
      const cleanResponse = response.replace(/```json\s*|\s*```/g, '').trim();
      
      const parsed = JSON.parse(cleanResponse);

      // Validate and normalize the response
      const analysis: AIAnalysisResult = {
        toxicity: Math.max(0, Math.min(1, parsed.toxicity || 0)),
        harassment: Math.max(0, Math.min(1, parsed.harassment || 0)),
        spam: Math.max(0, Math.min(1, parsed.spam || 0)),
        grooming: Math.max(0, Math.min(1, parsed.grooming || 0)),
        action: this.validateAction(parsed.action),
        reasoning: parsed.reasoning || 'No reasoning provided',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0))
      };

      return analysis;

    } catch (error) {
      this.logger.error('Failed to parse AI response', { 
        response: response,
        error: String(error) 
      });

      // Return safe defaults on parse error
      return {
        toxicity: 0,
        harassment: 0,
        spam: 0,
        grooming: 0,
        action: 'none',
        reasoning: 'AI analysis failed - defaulting to no action',
        confidence: 0
      };
    }
  }

  private validateAction(action: string): AIAnalysisResult['action'] {
    const validActions: AIAnalysisResult['action'][] = ['none', 'mask', 'delete_warn', 'shadowban', 'escalate'];
    
    if (validActions.includes(action as AIAnalysisResult['action'])) {
      return action as AIAnalysisResult['action'];
    }

    return 'none'; // Default to safe action
  }

  // Method to determine final action based on analysis and policy rules
  async determineAction(analysis: AIAnalysisResult, policyRules: ModerationRule[]): Promise<{
    action: string;
    ruleTriggered?: string;
    confidence: number;
  }> {
    const categories = ['toxicity', 'harassment', 'spam', 'grooming'] as const;
    
    for (const category of categories) {
      const score = analysis[category];
      const rule = policyRules.find(r => r.rule_type === category && r.enabled);
      
      if (rule && score >= rule.threshold) {
        return {
          action: rule.action,
          ruleTriggered: `${category}_threshold_${rule.threshold}`,
          confidence: score
        };
      }
    }

    // If AI suggested an action but no rule threshold was triggered, 
    // use the AI's suggestion if confidence is high enough
    if (analysis.action !== 'none' && analysis.confidence >= 0.8) {
      return {
        action: analysis.action,
        ruleTriggered: 'ai_high_confidence',
        confidence: analysis.confidence
      };
    }

    return {
      action: 'none',
      confidence: 1.0
    };
  }

  // Method to generate explanation for moderation logs
  generateExplanation(analysis: AIAnalysisResult, action: string): string {
    const scores = [
      `Toxicity: ${(analysis.toxicity * 100).toFixed(1)}%`,
      `Harassment: ${(analysis.harassment * 100).toFixed(1)}%`,
      `Spam: ${(analysis.spam * 100).toFixed(1)}%`,
      `Grooming Risk: ${(analysis.grooming * 100).toFixed(1)}%`
    ].join(', ');

    return `AI Analysis - ${scores}. Action: ${action}. Reasoning: ${analysis.reasoning}`;
  }
}