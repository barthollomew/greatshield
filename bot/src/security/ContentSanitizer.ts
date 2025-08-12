import { Logger } from '../utils/Logger';

export interface SanitizationResult {
  originalContent: string;
  sanitizedContent: string;
  modificationsApplied: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  blockedElements: string[];
}

export interface SanitizationConfig {
  // HTML/Script sanitization
  stripHtmlTags: boolean;
  stripScriptTags: boolean;
  allowedHtmlTags: string[];
  
  // Unicode normalization
  normalizeUnicode: boolean;
  removeZeroWidth: boolean;
  
  // URL sanitization
  sanitizeUrls: boolean;
  allowedDomains: string[];
  blockShorteners: boolean;
  
  // Content filtering
  maxLength: number;
  removeExcessiveWhitespace: boolean;
  removeRepeatedChars: boolean;
  
  // Encoding safety
  preventInjection: boolean;
  escapeSpecialChars: boolean;
}

export class ContentSanitizer {
  private logger: Logger;
  private config: SanitizationConfig;

  // Dangerous HTML tags and attributes
  private readonly DANGEROUS_TAGS = [
    'script', 'object', 'embed', 'form', 'input', 'textarea', 'button',
    'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'applet',
    'style', 'xml', 'svg', 'math'
  ];

  private readonly DANGEROUS_ATTRIBUTES = [
    'onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onblur',
    'onchange', 'onsubmit', 'onreset', 'onselect', 'onunload',
    'onkeypress', 'onkeydown', 'onkeyup', 'onmousedown', 'onmouseup',
    'javascript:', 'vbscript:', 'data:', 'livescript:', 'mocha:'
  ];

  // URL shortener domains
  private readonly URL_SHORTENERS = [
    'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'short.link',
    'tiny.cc', 'is.gd', 'buff.ly', 'adf.ly', 'bl.ink', 'cutt.ly'
  ];

  // SQL injection patterns
  private readonly SQL_INJECTION_PATTERNS = [
    /(\bUNION\s+SELECT\b|\bINSERT\s+INTO\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b)/gi,
    /(\bOR\s+1\s*=\s*1\b|\bAND\s+1\s*=\s*1\b)/gi,
    /(\bUPDATE\s+\w+\s+SET\b|\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b)/gi
  ];

  // XSS patterns
  private readonly XSS_PATTERNS = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript\s*:/gi,
    /on\w+\s*=/gi,
    /<img[^>]+src[^>]*>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi
  ];

  constructor(logger: Logger) {
    this.logger = logger;
    
    // Default configuration
    this.config = {
      stripHtmlTags: true,
      stripScriptTags: true,
      allowedHtmlTags: ['b', 'i', 'u', 'strong', 'em'],
      normalizeUnicode: true,
      removeZeroWidth: true,
      sanitizeUrls: true,
      allowedDomains: [],
      blockShorteners: true,
      maxLength: 2000,
      removeExcessiveWhitespace: true,
      removeRepeatedChars: true,
      preventInjection: true,
      escapeSpecialChars: true
    };
  }

  /**
   * Configure sanitization settings
   */
  setConfig(config: Partial<SanitizationConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Content sanitizer configuration updated');
  }

  /**
   * Sanitize content with comprehensive security measures
   */
  async sanitizeContent(content: string, userId?: string): Promise<SanitizationResult> {
    const result: SanitizationResult = {
      originalContent: content,
      sanitizedContent: content,
      modificationsApplied: [],
      riskLevel: 'low',
      blockedElements: []
    };

    try {
      // Early exit for empty content
      if (!content || content.trim().length === 0) {
        return result;
      }

      // Step 1: Check for injection attempts
      result.sanitizedContent = await this.preventInjectionAttacks(result.sanitizedContent, result);

      // Step 2: HTML/Script sanitization
      result.sanitizedContent = await this.sanitizeHtml(result.sanitizedContent, result);

      // Step 3: Unicode normalization
      result.sanitizedContent = await this.normalizeUnicode(result.sanitizedContent, result);

      // Step 4: URL sanitization
      result.sanitizedContent = await this.sanitizeUrls(result.sanitizedContent, result);

      // Step 5: Content filtering
      result.sanitizedContent = await this.filterContent(result.sanitizedContent, result);

      // Step 6: Length and format validation
      result.sanitizedContent = await this.validateFormat(result.sanitizedContent, result);

      // Step 7: Final safety checks
      result.sanitizedContent = await this.finalSafetyCheck(result.sanitizedContent, result);

      // Log high-risk sanitizations
      if (result.riskLevel === 'high' || result.riskLevel === 'critical') {
        this.logger.warn('High-risk content sanitized', {
          userId,
          riskLevel: result.riskLevel,
          modificationsApplied: result.modificationsApplied,
          blockedElements: result.blockedElements,
          originalLength: result.originalContent.length,
          sanitizedLength: result.sanitizedContent.length
        });
      }

    } catch (error) {
      this.logger.error('Content sanitization error', {
        userId,
        error: String(error)
      });

      // On error, return heavily sanitized content
      result.sanitizedContent = this.emergencySanitize(content);
      result.modificationsApplied.push('Emergency sanitization applied due to error');
      result.riskLevel = 'high';
    }

    return result;
  }

  /**
   * Prevent injection attacks
   */
  private async preventInjectionAttacks(content: string, result: SanitizationResult): Promise<string> {
    if (!this.config.preventInjection) return content;

    let sanitized = content;
    let modified = false;

    // Check for SQL injection
    for (const pattern of this.SQL_INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '[BLOCKED_SQL]');
        result.blockedElements.push('SQL injection attempt');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'critical');
        modified = true;
      }
    }

    // Check for XSS attempts
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '[BLOCKED_XSS]');
        result.blockedElements.push('XSS attempt');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'critical');
        modified = true;
      }
    }

    // Check for command injection
    const commandPattern = /[;&|`$(){}[\]\\]/g;
    if (commandPattern.test(sanitized)) {
      sanitized = sanitized.replace(commandPattern, '');
      result.blockedElements.push('Command injection characters');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
      modified = true;
    }

    // Check for path traversal
    const pathTraversalPattern = /\.\.\/|\.\.\\/g;
    if (pathTraversalPattern.test(sanitized)) {
      sanitized = sanitized.replace(pathTraversalPattern, '');
      result.blockedElements.push('Path traversal attempt');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
      modified = true;
    }

    if (modified) {
      result.modificationsApplied.push('Injection attack prevention');
    }

    return sanitized;
  }

  /**
   * Sanitize HTML content
   */
  private async sanitizeHtml(content: string, result: SanitizationResult): Promise<string> {
    let sanitized = content;
    let modified = false;

    // Remove dangerous tags
    if (this.config.stripScriptTags || this.config.stripHtmlTags) {
      for (const tag of this.DANGEROUS_TAGS) {
        const tagPattern = new RegExp(`<\\/?${tag}[^>]*>`, 'gi');
        if (tagPattern.test(sanitized)) {
          sanitized = sanitized.replace(tagPattern, '[BLOCKED_TAG]');
          result.blockedElements.push(`Dangerous HTML tag: ${tag}`);
          result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
          modified = true;
        }
      }
    }

    // Remove dangerous attributes
    for (const attr of this.DANGEROUS_ATTRIBUTES) {
      const attrPattern = new RegExp(`${attr}[^>]*`, 'gi');
      if (attrPattern.test(sanitized)) {
        sanitized = sanitized.replace(attrPattern, '');
        result.blockedElements.push(`Dangerous attribute: ${attr}`);
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
        modified = true;
      }
    }

    // Strip all HTML if configured (except allowed tags)
    if (this.config.stripHtmlTags) {
      const htmlPattern = /<[^>]+>/g;
      const htmlMatches = sanitized.match(htmlPattern);
      
      if (htmlMatches) {
        // Check if any non-allowed tags exist
        const hasDisallowedTags = htmlMatches.some(tag => {
          const tagName = tag.replace(/<\/?([^\s>]+).*/, '$1').toLowerCase();
          return !this.config.allowedHtmlTags.includes(tagName);
        });
        
        if (hasDisallowedTags) {
          sanitized = sanitized.replace(htmlPattern, '');
          result.modificationsApplied.push('HTML tags removed');
          result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
          modified = true;
        }
      }
    }

    if (modified) {
      result.modificationsApplied.push('HTML sanitization');
    }

    return sanitized;
  }

  /**
   * Normalize unicode characters
   */
  private async normalizeUnicode(content: string, result: SanitizationResult): Promise<string> {
    let sanitized = content;

    // Remove zero-width characters
    if (this.config.removeZeroWidth) {
      const zeroWidthPattern = /[\u200B-\u200D\uFEFF]/g;
      if (zeroWidthPattern.test(sanitized)) {
        sanitized = sanitized.replace(zeroWidthPattern, '');
        result.modificationsApplied.push('Zero-width characters removed');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
      }
    }

    // Unicode normalization
    if (this.config.normalizeUnicode) {
      try {
        const normalized = sanitized.normalize('NFC');
        if (normalized !== sanitized) {
          sanitized = normalized;
          result.modificationsApplied.push('Unicode normalized');
        }
      } catch (error) {
        this.logger.warn('Unicode normalization failed', { error: String(error) });
      }
    }

    // Remove or replace suspicious unicode patterns
    const suspiciousUnicode = /[\u0000-\u001F\u007F-\u009F]/g;
    if (suspiciousUnicode.test(sanitized)) {
      sanitized = sanitized.replace(suspiciousUnicode, '');
      result.modificationsApplied.push('Control characters removed');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    return sanitized;
  }

  /**
   * Sanitize URLs
   */
  private async sanitizeUrls(content: string, result: SanitizationResult): Promise<string> {
    if (!this.config.sanitizeUrls) return content;

    let sanitized = content;
    const urlPattern = /(https?:\/\/[^\s]+)/gi;
    const urls = content.match(urlPattern) || [];

    for (const url of urls) {
      let shouldBlock = false;
      let blockReason = '';

      try {
        const urlObj = new URL(url);

        // Check against URL shorteners
        if (this.config.blockShorteners && this.URL_SHORTENERS.includes(urlObj.hostname)) {
          shouldBlock = true;
          blockReason = 'URL shortener';
        }

        // Check against allowed domains (if configured)
        if (this.config.allowedDomains.length > 0) {
          const isAllowed = this.config.allowedDomains.some(domain => 
            urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
          );
          
          if (!isAllowed) {
            shouldBlock = true;
            blockReason = 'Domain not in allowlist';
          }
        }

        // Check for suspicious URL patterns
        if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(urlObj.hostname)) {
          result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
          result.modificationsApplied.push('Suspicious IP-based URL detected');
        }

        // Check for suspicious parameters
        if (/[?&](?:exec|eval|script|cmd)=/i.test(url)) {
          shouldBlock = true;
          blockReason = 'Suspicious URL parameters';
          result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
        }

        if (shouldBlock) {
          sanitized = sanitized.replace(url, `[BLOCKED_URL: ${blockReason}]`);
          result.blockedElements.push(`URL: ${blockReason}`);
          result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
          result.modificationsApplied.push('URL blocked');
        }

      } catch (urlError) {
        // Invalid URL - block it
        sanitized = sanitized.replace(url, '[INVALID_URL]');
        result.blockedElements.push('Invalid URL format');
        result.modificationsApplied.push('Invalid URL removed');
      }
    }

    return sanitized;
  }

  /**
   * Filter content for spam and excessive patterns
   */
  private async filterContent(content: string, result: SanitizationResult): Promise<string> {
    let sanitized = content;

    // Remove excessive whitespace
    if (this.config.removeExcessiveWhitespace) {
      const originalLength = sanitized.length;
      sanitized = sanitized.replace(/\s+/g, ' ').trim();
      
      if (sanitized.length < originalLength * 0.7) {
        result.modificationsApplied.push('Excessive whitespace removed');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
      }
    }

    // Remove repeated characters (spam detection)
    if (this.config.removeRepeatedChars) {
      const repeatedPattern = /(.)\1{5,}/g;
      if (repeatedPattern.test(sanitized)) {
        sanitized = sanitized.replace(repeatedPattern, '$1$1$1');
        result.modificationsApplied.push('Repeated characters reduced');
        result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
      }
    }

    // Check for excessive special characters
    const specialCharRatio = (sanitized.match(/[^\w\s]/g) || []).length / sanitized.length;
    if (specialCharRatio > 0.6 && sanitized.length > 10) {
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
      result.modificationsApplied.push('High special character ratio detected');
    }

    return sanitized;
  }

  /**
   * Validate format and length
   */
  private async validateFormat(content: string, result: SanitizationResult): Promise<string> {
    let sanitized = content;

    // Enforce maximum length
    if (sanitized.length > this.config.maxLength) {
      sanitized = sanitized.substring(0, this.config.maxLength) + '...';
      result.modificationsApplied.push(`Content truncated to ${this.config.maxLength} characters`);
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'medium');
    }

    return sanitized;
  }

  /**
   * Final safety check
   */
  private async finalSafetyCheck(content: string, result: SanitizationResult): Promise<string> {
    let sanitized = content;

    // Escape special characters if configured
    if (this.config.escapeSpecialChars) {
      const specialChars = /[<>&"']/g;
      if (specialChars.test(sanitized)) {
        sanitized = sanitized
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        
        result.modificationsApplied.push('Special characters escaped');
      }
    }

    // Final null byte check
    if (sanitized.includes('\0')) {
      sanitized = sanitized.replace(/\0/g, '');
      result.modificationsApplied.push('Null bytes removed');
      result.riskLevel = this.escalateRiskLevel(result.riskLevel, 'high');
    }

    return sanitized;
  }

  /**
   * Emergency sanitization for error cases
   */
  private emergencySanitize(content: string): string {
    return content
      .replace(/[<>&"']/g, '')
      .replace(/[^\w\s\-.,!?]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 500);
  }

  /**
   * Escalate risk level to higher severity
   */
  private escalateRiskLevel(current: SanitizationResult['riskLevel'], newLevel: SanitizationResult['riskLevel']): SanitizationResult['riskLevel'] {
    const levels = { low: 0, medium: 1, high: 2, critical: 3 };
    return levels[newLevel] > levels[current] ? newLevel : current;
  }

  /**
   * Sanitize filename for safe storage
   */
  sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/\.+/g, '.')
      .replace(/_+/g, '_')
      .substring(0, 255);
  }

  /**
   * Get sanitizer statistics
   */
  getStatistics(): {
    config: SanitizationConfig;
    memoryUsage: number;
  } {
    return {
      config: this.config,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    };
  }
}