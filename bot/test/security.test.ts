import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { InputValidator, ValidationResult } from '../src/security/InputValidator';
import { RateLimiter, RateLimitConfig } from '../src/security/RateLimiter';
import { ContentSanitizer, SanitizationConfig } from '../src/security/ContentSanitizer';
import { DatabaseManager } from '../src/database/DatabaseManager';
import { Logger } from '../src/utils/Logger';

// Mock Discord.js Message
const createMockMessage = (content: string, userId: string = 'user123', channelId: string = 'channel123') => ({
  id: 'msg123',
  content,
  author: {
    id: userId,
    username: 'testuser',
    bot: false,
    client: { user: { id: 'bot123' } }
  },
  channelId,
  guildId: 'guild123',
  attachments: new Map(),
  reply: jest.fn()
});

describe('Security System Tests', () => {
  let logger: Logger;
  let db: DatabaseManager;
  let inputValidator: InputValidator;
  let rateLimiter: RateLimiter;
  let contentSanitizer: ContentSanitizer;

  beforeEach(async () => {
    // Create logger and database
    logger = new Logger('test', 'info');
    db = new DatabaseManager();
    await db.initialize(':memory:');

    // Initialize security components
    inputValidator = new InputValidator(logger);
    rateLimiter = new RateLimiter(logger, db);
    contentSanitizer = new ContentSanitizer(logger);
  });

  afterEach(async () => {
    rateLimiter?.destroy();
    db?.close();
  });

  describe('InputValidator', () => {
    it('should validate normal messages', async () => {
      const message = createMockMessage('Hello, this is a normal message');
      const result = await inputValidator.validateMessage(message as any);

      expect(result.isValid).toBe(true);
      expect(result.riskLevel).toBe('low');
      expect(result.errors).toHaveLength(0);
      expect(result.sanitizedContent).toBe('Hello, this is a normal message');
    });

    it('should detect SQL injection attempts', async () => {
      const message = createMockMessage('Hello; DROP TABLE users; --');
      const result = await inputValidator.validateMessage(message as any);

      expect(result.isValid).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.errors.some(e => e.includes('injection'))).toBe(true);
    });

    it('should detect XSS attempts', async () => {
      const message = createMockMessage('<script>alert("xss")</script>');
      const result = await inputValidator.validateMessage(message as any);

      expect(result.isValid).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.errors.some(e => e.includes('injection'))).toBe(true);
    });

    it('should detect excessive message length', async () => {
      const longMessage = 'A'.repeat(3000);
      const message = createMockMessage(longMessage);
      const result = await inputValidator.validateMessage(message as any);

      expect(result.isValid).toBe(false);
      expect(result.riskLevel).toBe('medium');
      expect(result.errors.some(e => e.includes('length'))).toBe(true);
    });

    it('should detect zero-width characters', async () => {
      const message = createMockMessage('Hello\u200Bworld\uFEFF');
      const result = await inputValidator.validateMessage(message as any);

      expect(result.riskLevel).toBe('high');
      expect(result.errors.some(e => e.includes('Zero-width'))).toBe(true);
    });

    it('should detect suspicious URLs', async () => {
      const message = createMockMessage('Check out this link: http://192.168.1.1/malicious');
      const result = await inputValidator.validateMessage(message as any);

      expect(result.riskLevel).toBe('medium');
      expect(result.errors.some(e => e.includes('URL'))).toBe(true);
    });

    it('should validate attachments', async () => {
      const message = {
        ...createMockMessage('File attachment'),
        attachments: new Map([
          ['1', {
            id: '1',
            name: 'malicious.exe',
            size: 1024,
            url: 'https://example.com/file.exe'
          }]
        ])
      };

      const result = await inputValidator.validateMessage(message as any);

      expect(result.isValid).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.errors.some(e => e.includes('Dangerous file type'))).toBe(true);
    });

    it('should detect repeated character spam', async () => {
      const message = createMockMessage('aaaaaaaaaaaaaaaaaaa');
      const result = await inputValidator.validateMessage(message as any);

      expect(result.riskLevel).toBe('medium');
      expect(result.errors.some(e => e.includes('spam'))).toBe(true);
    });

    it('should clean up expired rate limits', () => {
      inputValidator.cleanupRateLimits();
      
      const status = inputValidator.getRateLimitStatus();
      expect(typeof status.userCount).toBe('number');
      expect(typeof status.channelCount).toBe('number');
      expect(typeof status.memoryUsage).toBe('number');
    });
  });

  describe('RateLimiter', () => {
    it('should allow messages within rate limits', async () => {
      const message = createMockMessage('Normal message');
      const result = await rateLimiter.checkMessageRateLimit(message as any);

      expect(result.allowed).toBe(true);
      expect(result.penaltyLevel).toBe('none');
      expect(result.remainingRequests).toBeGreaterThan(0);
    });

    it('should enforce per-minute rate limits', async () => {
      const config: Partial<RateLimitConfig> = {
        messagesPerMinute: 2,
        burstLimit: 10
      };
      rateLimiter.setConfig(config);

      const message = createMockMessage('Test message', 'user123');

      // First two messages should be allowed
      let result = await rateLimiter.checkMessageRateLimit(message as any);
      expect(result.allowed).toBe(true);

      result = await rateLimiter.checkMessageRateLimit(message as any);
      expect(result.allowed).toBe(true);

      // Third message should be blocked
      result = await rateLimiter.checkMessageRateLimit(message as any);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Per-minute');
    });

    it('should enforce burst protection', async () => {
      const config: Partial<RateLimitConfig> = {
        burstLimit: 2,
        burstWindowMs: 1000
      };
      rateLimiter.setConfig(config);

      const message = createMockMessage('Burst message', 'user456');

      // First two messages in burst should be allowed
      let result = await rateLimiter.checkMessageRateLimit(message as any);
      expect(result.allowed).toBe(true);

      result = await rateLimiter.checkMessageRateLimit(message as any);
      expect(result.allowed).toBe(true);

      // Third message should trigger burst protection
      result = await rateLimiter.checkMessageRateLimit(message as any);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Burst');
    });

    it('should track channel-specific limits', async () => {
      const config: Partial<RateLimitConfig> = {
        channelMessagesPerMinute: 2
      };
      rateLimiter.setConfig(config);

      const message1 = createMockMessage('Message 1', 'user1', 'channel1');
      const message2 = createMockMessage('Message 2', 'user2', 'channel1');
      const message3 = createMockMessage('Message 3', 'user3', 'channel1');

      // First two messages should be allowed
      let result = await rateLimiter.checkMessageRateLimit(message1 as any);
      expect(result.allowed).toBe(true);

      result = await rateLimiter.checkMessageRateLimit(message2 as any);
      expect(result.allowed).toBe(true);

      // Third message should be blocked due to channel limit
      result = await rateLimiter.checkMessageRateLimit(message3 as any);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Channel');
    });

    it('should allow moderation actions for users without violations', async () => {
      const result = await rateLimiter.checkModerationActionRateLimit('cleanUser123');
      expect(result.allowed).toBe(true);
    });

    it('should reset user limits', () => {
      rateLimiter.resetUserLimits('user123');
      // Should not throw an error
    });

    it('should provide statistics', () => {
      const stats = rateLimiter.getStatistics();
      expect(typeof stats.userEntries).toBe('number');
      expect(typeof stats.channelEntries).toBe('number');
      expect(typeof stats.totalViolations).toBe('number');
      expect(typeof stats.memoryUsage).toBe('number');
    });
  });

  describe('ContentSanitizer', () => {
    it('should sanitize normal content', async () => {
      const result = await contentSanitizer.sanitizeContent('Hello world!');

      expect(result.sanitizedContent).toBe('Hello world!');
      expect(result.riskLevel).toBe('low');
      expect(result.modificationsApplied).toHaveLength(0);
      expect(result.blockedElements).toHaveLength(0);
    });

    it('should block SQL injection attempts', async () => {
      const maliciousContent = "'; DROP TABLE users; --";
      const result = await contentSanitizer.sanitizeContent(maliciousContent);

      expect(result.sanitizedContent).toContain('[BLOCKED_SQL]');
      expect(result.riskLevel).toBe('critical');
      expect(result.blockedElements.some(e => e.includes('SQL'))).toBe(true);
    });

    it('should block XSS attempts', async () => {
      const xssContent = '<script>alert("xss")</script>';
      const result = await contentSanitizer.sanitizeContent(xssContent);

      expect(result.sanitizedContent).toContain('[BLOCKED_XSS]');
      expect(result.riskLevel).toBe('critical');
      expect(result.blockedElements.some(e => e.includes('XSS'))).toBe(true);
    });

    it('should remove dangerous HTML tags', async () => {
      const htmlContent = '<iframe src="malicious.html"></iframe>Hello';
      const result = await contentSanitizer.sanitizeContent(htmlContent);

      expect(result.sanitizedContent).toContain('[BLOCKED_TAG]');
      expect(result.riskLevel).toBe('high');
      expect(result.modificationsApplied.some(m => m.includes('HTML'))).toBe(true);
    });

    it('should normalize unicode characters', async () => {
      const unicodeContent = 'Hello\u200Bworld\uFEFF';
      const result = await contentSanitizer.sanitizeContent(unicodeContent);

      expect(result.sanitizedContent).toBe('Helloworld');
      expect(result.modificationsApplied.some(m => m.includes('Zero-width'))).toBe(true);
    });

    it('should sanitize malicious URLs', async () => {
      const config: Partial<SanitizationConfig> = {
        sanitizeUrls: true,
        blockShorteners: true
      };
      contentSanitizer.setConfig(config);

      const urlContent = 'Check this out: http://bit.ly/malicious';
      const result = await contentSanitizer.sanitizeContent(urlContent);

      expect(result.sanitizedContent).toContain('[BLOCKED_URL');
      expect(result.blockedElements.some(e => e.includes('URL'))).toBe(true);
    });

    it('should remove excessive whitespace', async () => {
      const spamContent = 'Hello     world     with     lots     of     spaces';
      const result = await contentSanitizer.sanitizeContent(spamContent);

      expect(result.sanitizedContent).toBe('Hello world with lots of spaces');
      expect(result.modificationsApplied.some(m => m.includes('whitespace'))).toBe(true);
    });

    it('should reduce repeated characters', async () => {
      const spamContent = 'Helloooooooooooo';
      const result = await contentSanitizer.sanitizeContent(spamContent);

      expect(result.sanitizedContent).toBe('Hellooo');
      expect(result.modificationsApplied.some(m => m.includes('Repeated'))).toBe(true);
    });

    it('should truncate overly long content', async () => {
      const config: Partial<SanitizationConfig> = {
        maxLength: 50
      };
      contentSanitizer.setConfig(config);

      const longContent = 'A'.repeat(100);
      const result = await contentSanitizer.sanitizeContent(longContent);

      expect(result.sanitizedContent.length).toBeLessThanOrEqual(53); // 50 + "..."
      expect(result.modificationsApplied.some(m => m.includes('truncated'))).toBe(true);
    });

    it('should escape special characters when configured', async () => {
      const config: Partial<SanitizationConfig> = {
        escapeSpecialChars: true
      };
      contentSanitizer.setConfig(config);

      const specialContent = '<Hello> & "World"';
      const result = await contentSanitizer.sanitizeContent(specialContent);

      expect(result.sanitizedContent).toContain('&lt;');
      expect(result.sanitizedContent).toContain('&gt;');
      expect(result.sanitizedContent).toContain('&amp;');
      expect(result.sanitizedContent).toContain('&quot;');
    });

    it('should sanitize filenames', () => {
      const dangerousFilename = '../../malicious<script>.exe';
      const sanitized = contentSanitizer.sanitizeFilename(dangerousFilename);

      expect(sanitized).toBe('.__malicious_script_.exe');
      expect(sanitized.length).toBeLessThanOrEqual(255);
    });

    it('should handle null bytes', async () => {
      const nullByteContent = 'Hello\x00World';
      const result = await contentSanitizer.sanitizeContent(nullByteContent);

      expect(result.sanitizedContent).toBe('HelloWorld');
      expect(result.modificationsApplied.some(m => m.includes('Null bytes'))).toBe(true);
      expect(result.riskLevel).toBe('high');
    });

    it('should provide sanitizer statistics', () => {
      const stats = contentSanitizer.getStatistics();
      expect(stats.config).toBeDefined();
      expect(typeof stats.memoryUsage).toBe('number');
    });

    it('should handle errors gracefully', async () => {
      // Create a content that might cause processing errors
      const problematicContent = '\uD800'; // Invalid surrogate pair
      const result = await contentSanitizer.sanitizeContent(problematicContent);

      // Should still return a result, even if emergency sanitization is applied
      expect(result.sanitizedContent).toBeDefined();
      expect(typeof result.riskLevel).toBe('string');
    });
  });

  describe('Integration Tests', () => {
    it('should work together to secure a malicious message', async () => {
      const maliciousMessage = createMockMessage(
        '<script>alert("xss")</script> OR 1=1; DROP TABLE users; https://bit.ly/malicious \u200B\uFEFF'
      );

      // Validation
      const validationResult = await inputValidator.validateMessage(maliciousMessage as any);
      expect(validationResult.isValid).toBe(false);
      expect(validationResult.riskLevel).toBe('critical');

      // Rate limiting
      const rateLimitResult = await rateLimiter.checkMessageRateLimit(maliciousMessage as any);
      expect(rateLimitResult.allowed).toBe(true); // First message, so allowed

      // Sanitization
      const sanitizationResult = await contentSanitizer.sanitizeContent(maliciousMessage.content);
      expect(sanitizationResult.riskLevel).toBe('critical');
      expect(sanitizationResult.blockedElements.length).toBeGreaterThan(0);
    });

    it('should handle rapid-fire malicious messages', async () => {
      const config: Partial<RateLimitConfig> = {
        messagesPerMinute: 3,
        burstLimit: 2
      };
      rateLimiter.setConfig(config);

      const maliciousContent = '<script>eval(document.cookie)</script>';
      
      for (let i = 0; i < 5; i++) {
        const message = createMockMessage(maliciousContent, 'attacker123');
        
        const rateLimitResult = await rateLimiter.checkMessageRateLimit(message as any);
        const validationResult = await inputValidator.validateMessage(message as any);
        
        if (i >= 2) {
          // After burst limit, should be rate limited
          expect(rateLimitResult.allowed).toBe(false);
        }
        
        // All messages should fail validation due to XSS
        expect(validationResult.isValid).toBe(false);
        expect(validationResult.riskLevel).toBe('critical');
      }
    });

    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      const iterations = 100;
      
      for (let i = 0; i < iterations; i++) {
        const message = createMockMessage(`Test message ${i}`, `user${i % 10}`);
        
        await Promise.all([
          inputValidator.validateMessage(message as any),
          rateLimiter.checkMessageRateLimit(message as any),
          contentSanitizer.sanitizeContent(message.content)
        ]);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTime = totalTime / iterations;
      
      // Should process each message in under 50ms on average
      expect(avgTime).toBeLessThan(50);
    });
  });
});