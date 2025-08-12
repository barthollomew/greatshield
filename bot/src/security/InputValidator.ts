import { Message } from 'discord.js';
import { Logger } from '../utils/Logger';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedContent?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class InputValidator {
  private logger: Logger;
  private readonly MAX_MESSAGE_LENGTH = 2000;
  private readonly MAX_USERNAME_LENGTH = 32;
  
  // Patterns for potential security threats
  private readonly INJECTION_PATTERNS = [
    // SQL injection attempts
    /(\bUNION\s+SELECT\b|\bINSERT\s+INTO\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b)/i,
    // Script injection
    /<script[^>]*>.*?<\/script>/gi,
    // Command injection
    /[;&|`$(){}[\]\\]/,
    // Path traversal
    /\.\.\/|\.\.\\/,
    // Null bytes
    /\x00/,
  ];

  // Patterns for malicious URLs
  private readonly MALICIOUS_URL_PATTERNS = [
    // IP addresses instead of domains (suspicious)
    /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    // URL shorteners (potential risk)
    /(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|short\.link)/i,
    // Suspicious TLDs
    /\.(?:tk|ml|ga|cf|click|download|exe|scr|bat|com\.exe)(?:\s|$|\/)/i,
  ];

  // Rate limiting tracking
  private userMessageCounts = new Map<string, { count: number; lastReset: number }>();
  private channelMessageCounts = new Map<string, { count: number; lastReset: number }>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Validates and sanitizes a Discord message
   */
  async validateMessage(message: Message): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      riskLevel: 'low'
    };

    try {
      // Basic validation
      this.validateBasicStructure(message, result);

      // Content validation
      this.validateContent(message.content, result);

      // Rate limiting check
      await this.checkRateLimits(message, result);

      // URL validation
      this.validateUrls(message.content, result);

      // Attachment validation
      await this.validateAttachments(message, result);

      // User validation
      this.validateUser(message.author, result);

      // Sanitize content if valid
      if (result.isValid) {
        result.sanitizedContent = this.sanitizeContent(message.content);
      }

    } catch (error) {
      this.logger.error('Error in message validation', {
        messageId: message.id,
        error: String(error)
      });
      
      result.isValid = false;
      result.errors.push('Validation system error');
      result.riskLevel = 'high';
    }

    // Log validation results for high-risk messages
    if (result.riskLevel === 'high' || result.riskLevel === 'critical') {
      this.logger.warn('High-risk message detected', {
        messageId: message.id,
        userId: message.author.id,
        channelId: message.channelId,
        riskLevel: result.riskLevel,
        errors: result.errors
      });
    }

    return result;
  }

  /**
   * Validates basic message structure
   */
  private validateBasicStructure(message: Message, result: ValidationResult): void {
    // Check message length
    if (message.content.length > this.MAX_MESSAGE_LENGTH) {
      result.errors.push('Message exceeds maximum length');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    // Check for null or undefined content
    if (message.content === null || message.content === undefined) {
      result.errors.push('Message content is null or undefined');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    // Check for extremely short but suspicious content
    if (message.content.length < 3 && /[^\w\s]/.test(message.content)) {
      result.errors.push('Suspicious short message with special characters');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }
  }

  /**
   * Validates message content for security threats
   */
  private validateContent(content: string, result: ValidationResult): void {
    // Check for injection patterns
    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        result.errors.push('Potential code injection detected');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'critical');
        result.isValid = false;
        break;
      }
    }

    // Check for excessive special characters (potential spam/bypass)
    const specialCharRatio = (content.match(/[^\w\s]/g) || []).length / content.length;
    if (specialCharRatio > 0.5 && content.length > 10) {
      result.errors.push('Excessive special characters detected');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    // Check for repeated characters (spam detection)
    const repeatedChars = content.match(/(.)\1{9,}/g);
    if (repeatedChars && repeatedChars.length > 0) {
      result.errors.push('Repeated character spam detected');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    // Check for excessive whitespace/unicode manipulation
    const whitespaceRatio = (content.match(/\s/g) || []).length / content.length;
    if (whitespaceRatio > 0.8 && content.length > 20) {
      result.errors.push('Excessive whitespace detected');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    // Check for zero-width characters (potential bypass)
    if (/[\u200B-\u200D\uFEFF]/.test(content)) {
      result.errors.push('Zero-width characters detected');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
    }
  }

  /**
   * Validates URLs in message content
   */
  private validateUrls(content: string, result: ValidationResult): void {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const urls = content.match(urlRegex) || [];

    for (const url of urls) {
      // Check against malicious patterns
      for (const pattern of this.MALICIOUS_URL_PATTERNS) {
        if (pattern.test(url)) {
          result.errors.push(`Suspicious URL detected: ${url}`);
          result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
          break;
        }
      }

      // Check for excessively long URLs (potential buffer overflow)
      if (url.length > 2048) {
        result.errors.push('Excessively long URL detected');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
      }

      // Check for suspicious query parameters
      if (/[?&](?:exec|eval|script|cmd)=/i.test(url)) {
        result.errors.push('Suspicious URL parameters detected');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
      }
    }

    // Check for excessive URL count (spam)
    if (urls.length > 5) {
      result.errors.push('Excessive URL count detected');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }
  }

  /**
   * Validates message attachments
   */
  private async validateAttachments(message: Message, result: ValidationResult): Promise<void> {
    if (message.attachments.size === 0) return;

    // Check attachment count
    if (message.attachments.size > 10) {
      result.errors.push('Excessive attachment count');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    for (const attachment of message.attachments.values()) {
      // Check file size (50MB limit)
      if (attachment.size > 50 * 1024 * 1024) {
        result.errors.push(`Large attachment detected: ${attachment.name}`);
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
      }

      // Check for dangerous file extensions
      const dangerousExtensions = [
        '.exe', '.scr', '.bat', '.cmd', '.com', '.pif', '.jar',
        '.vbs', '.js', '.ps1', '.sh', '.php', '.asp', '.aspx'
      ];
      
      const extension = attachment.name?.toLowerCase().split('.').pop();
      if (extension && dangerousExtensions.includes(`.${extension}`)) {
        result.errors.push(`Dangerous file type: ${attachment.name}`);
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'critical');
        result.isValid = false;
      }

      // Check for double extensions (bypass attempt)
      if (attachment.name && (attachment.name.match(/\./g) || []).length > 2) {
        result.errors.push(`Suspicious filename: ${attachment.name}`);
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
      }
    }
  }

  /**
   * Validates user information
   */
  private validateUser(user: any, result: ValidationResult): void {
    // Check username length
    if (user.username && user.username.length > this.MAX_USERNAME_LENGTH) {
      result.errors.push('Username exceeds maximum length');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    // Check for suspicious unicode in username
    if (user.username && /[\u200B-\u200D\uFEFF]/.test(user.username)) {
      result.errors.push('Suspicious characters in username');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
    }

    // Check if user is a bot (but not our own moderation bot)
    if (user.bot && user.id !== user.client?.user?.id) {
      result.errors.push('Message from unverified bot account');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }
  }

  /**
   * Checks rate limits for user and channel
   */
  private async checkRateLimits(message: Message, result: ValidationResult): Promise<void> {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const userLimit = 30; // messages per minute per user
    const channelLimit = 100; // messages per minute per channel

    // User rate limit
    const userKey = message.author.id;
    let userData = this.userMessageCounts.get(userKey);
    
    if (!userData || (now - userData.lastReset) > windowMs) {
      userData = { count: 0, lastReset: now };
    }
    
    userData.count++;
    this.userMessageCounts.set(userKey, userData);

    if (userData.count > userLimit) {
      result.errors.push('User rate limit exceeded');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
    }

    // Channel rate limit
    const channelKey = message.channelId;
    let channelData = this.channelMessageCounts.get(channelKey);
    
    if (!channelData || (now - channelData.lastReset) > windowMs) {
      channelData = { count: 0, lastReset: now };
    }
    
    channelData.count++;
    this.channelMessageCounts.set(channelKey, channelData);

    if (channelData.count > channelLimit) {
      result.errors.push('Channel rate limit exceeded');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }
  }

  /**
   * Sanitizes message content
   */
  private sanitizeContent(content: string): string {
    // Remove zero-width characters
    let sanitized = content.replace(/[\u200B-\u200D\uFEFF]/g, '');
    
    // Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Remove or escape HTML-like content
    sanitized = sanitized.replace(/<[^>]*>/g, '');
    
    // Limit length
    if (sanitized.length > this.MAX_MESSAGE_LENGTH) {
      sanitized = sanitized.substring(0, this.MAX_MESSAGE_LENGTH) + '...';
    }
    
    return sanitized;
  }

  /**
   * Escalates risk level to higher severity
   */
  private escalateRiskLevel(current: ValidationResult['riskLevel'], new_level: ValidationResult['riskLevel']): ValidationResult['riskLevel'] {
    const levels = { low: 0, medium: 1, high: 2, critical: 3 };
    return levels[new_level] > levels[current] ? new_level : current;
  }

  /**
   * Cleans up expired rate limit entries
   */
  cleanupRateLimits(): void {
    const now = Date.now();
    const windowMs = 60 * 1000;

    // Clean user rate limits
    for (const [key, data] of this.userMessageCounts.entries()) {
      if ((now - data.lastReset) > windowMs) {
        this.userMessageCounts.delete(key);
      }
    }

    // Clean channel rate limits
    for (const [key, data] of this.channelMessageCounts.entries()) {
      if ((now - data.lastReset) > windowMs) {
        this.channelMessageCounts.delete(key);
      }
    }
  }

  /**
   * Gets current rate limit status
   */
  getRateLimitStatus(): {
    userCount: number;
    channelCount: number;
    memoryUsage: number;
  } {
    return {
      userCount: this.userMessageCounts.size,
      channelCount: this.channelMessageCounts.size,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    };
  }
}