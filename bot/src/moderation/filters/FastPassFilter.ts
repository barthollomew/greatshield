import { DatabaseManager, BotConfig } from '../../database/DatabaseManager.js';
import { Logger } from '../../utils/Logger.js';

export interface FastPassResult {
  triggered: boolean;
  ruleTriggered?: string;
  severity?: string;
  action?: string;
  reason?: string;
  confidence?: number;
}

export class FastPassFilter {
  private db: DatabaseManager;
  private logger: Logger;
  private bannedWords: Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}> = [];
  private blockedUrls: Array<{url_pattern: string, is_regex: boolean, reason: string, action: string}> = [];
  private policyPackId?: number;

  constructor(db: DatabaseManager, logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  async initialize(config: BotConfig): Promise<void> {
    if (!config.active_policy_pack_id) {
      throw new Error('No active policy pack configured');
    }

    this.policyPackId = config.active_policy_pack_id;
    
    // Load banned words and blocked URLs
    this.bannedWords = await this.db.getBannedWords(this.policyPackId);
    this.blockedUrls = await this.db.getBlockedUrls(this.policyPackId);

    this.logger.info('Fast pass filter initialized', {
      policyPackId: this.policyPackId,
      bannedWordsCount: this.bannedWords.length,
      blockedUrlsCount: this.blockedUrls.length
    });
  }

  async checkMessage(content: string, _userId: string, _channelId: string): Promise<FastPassResult> {
    // Check banned words
    const wordCheck = await this.checkBannedWords(content);
    if (wordCheck.triggered) {
      return wordCheck;
    }

    // Check blocked URLs
    const urlCheck = await this.checkBlockedUrls(content);
    if (urlCheck.triggered) {
      return urlCheck;
    }

    // Check spam patterns
    const spamCheck = await this.checkSpamPatterns(content, userId, channelId);
    if (spamCheck.triggered) {
      return spamCheck;
    }

    // Check repetition patterns
    const repetitionCheck = await this.checkRepetition(content);
    if (repetitionCheck.triggered) {
      return repetitionCheck;
    }

    return { triggered: false };
  }

  private async checkBannedWords(content: string): Promise<FastPassResult> {
    for (const rule of this.bannedWords) {
      let matches = false;

      if (rule.is_regex) {
        try {
          const regex = new RegExp(rule.word_or_phrase, 'gi');
          matches = regex.test(content);
        } catch (error) {
          this.logger.error('Invalid regex in banned words', { 
            pattern: rule.word_or_phrase, 
            error: String(error) 
          });
          continue;
        }
      } else {
        // Simple case-insensitive string matching
        matches = content.toLowerCase().includes(rule.word_or_phrase.toLowerCase());
      }

      if (matches) {
        return {
          triggered: true,
          ruleTriggered: `banned_word:${rule.word_or_phrase}`,
          severity: rule.severity,
          action: rule.action,
          reason: `Banned word/phrase detected: ${rule.word_or_phrase}`,
          confidence: 1.0
        };
      }
    }

    return { triggered: false };
  }

  private async checkBlockedUrls(content: string): Promise<FastPassResult> {
    for (const rule of this.blockedUrls) {
      let matches = false;

      if (rule.is_regex) {
        try {
          const regex = new RegExp(rule.url_pattern, 'gi');
          matches = regex.test(content);
        } catch (error) {
          this.logger.error('Invalid regex in blocked URLs', { 
            pattern: rule.url_pattern, 
            error: String(error) 
          });
          continue;
        }
      } else {
        // Simple URL matching
        matches = content.toLowerCase().includes(rule.url_pattern.toLowerCase());
      }

      if (matches) {
        return {
          triggered: true,
          ruleTriggered: `blocked_url:${rule.url_pattern}`,
          severity: 'medium',
          action: rule.action,
          reason: rule.reason || `Blocked URL pattern detected: ${rule.url_pattern}`,
          confidence: 1.0
        };
      }
    }

    return { triggered: false };
  }

  private async checkSpamPatterns(content: string, userId: string, channelId: string): Promise<FastPassResult> {
    // Check for excessive caps
    const capsRatio = this.getCapsRatio(content);
    if (content.length > 20 && capsRatio > 0.7) {
      return {
        triggered: true,
        ruleTriggered: 'excessive_caps',
        severity: 'low',
        action: 'mask',
        reason: `Excessive use of capital letters (${Math.round(capsRatio * 100)}%)`,
        confidence: 0.8
      };
    }

    // Check for excessive emoji
    const emojiCount = this.getEmojiCount(content);
    if (emojiCount > 10) {
      return {
        triggered: true,
        ruleTriggered: 'excessive_emoji',
        severity: 'low',
        action: 'mask',
        reason: `Excessive emoji usage (${emojiCount} emojis)`,
        confidence: 0.7
      };
    }

    // Check for very long messages (potential spam)
    if (content.length > 2000) {
      return {
        triggered: true,
        ruleTriggered: 'excessive_length',
        severity: 'low',
        action: 'mask',
        reason: `Message too long (${content.length} characters)`,
        confidence: 0.6
      };
    }

    // Check for excessive mentions
    const mentionCount = (content.match(/@/g) || []).length;
    if (mentionCount > 5) {
      return {
        triggered: true,
        ruleTriggered: 'excessive_mentions',
        severity: 'medium',
        action: 'delete_warn',
        reason: `Excessive mentions (${mentionCount} mentions)`,
        confidence: 0.8
      };
    }

    // Check for potential zalgo text (excessive combining characters)
    const combiningCharsCount = (content.match(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g) || []).length;
    if (combiningCharsCount > 50) {
      return {
        triggered: true,
        ruleTriggered: 'zalgo_text',
        severity: 'medium',
        action: 'delete_warn',
        reason: 'Potentially malicious text formatting (zalgo)',
        confidence: 0.9
      };
    }

    return { triggered: false };
  }

  private async checkRepetition(content: string): Promise<FastPassResult> {
    // Check for repeated characters
    const repeatedCharMatch = content.match(/(.)\1{10,}/g);
    if (repeatedCharMatch) {
      return {
        triggered: true,
        ruleTriggered: 'repeated_characters',
        severity: 'low',
        action: 'mask',
        reason: 'Excessive character repetition detected',
        confidence: 0.8
      };
    }

    // Check for repeated words
    const words = content.toLowerCase().split(/\s+/);
    const wordCounts = new Map<string, number>();
    
    for (const word of words) {
      if (word.length > 3) { // Only count words longer than 3 characters
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    for (const [word, count] of wordCounts) {
      if (count >= 5) {
        return {
          triggered: true,
          ruleTriggered: 'repeated_words',
          severity: 'low',
          action: 'mask',
          reason: `Excessive word repetition: "${word}" repeated ${count} times`,
          confidence: 0.7
        };
      }
    }

    return { triggered: false };
  }

  private getCapsRatio(content: string): number {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) return 0;
    
    const caps = content.replace(/[^A-Z]/g, '');
    return caps.length / letters.length;
  }

  private getEmojiCount(content: string): number {
    // Simple emoji detection (Unicode emoji ranges)
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    return (content.match(emojiRegex) || []).length;
  }

  // Method to reload rules (useful for dynamic updates)
  async reloadRules(): Promise<void> {
    if (this.policyPackId) {
      this.bannedWords = await this.db.getBannedWords(this.policyPackId);
      this.blockedUrls = await this.db.getBlockedUrls(this.policyPackId);
      
      this.logger.info('Fast pass filter rules reloaded', {
        policyPackId: this.policyPackId,
        bannedWordsCount: this.bannedWords.length,
        blockedUrlsCount: this.blockedUrls.length
      });
    }
  }
}