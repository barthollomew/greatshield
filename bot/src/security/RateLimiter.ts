import { Message } from 'discord.js';
import { Logger } from '../utils/Logger';
import { DatabaseManager } from '../database/DatabaseManager';

export interface RateLimitConfig {
  // Message rate limits
  messagesPerMinute: number;
  messagesPerHour: number;
  messagesPerDay: number;
  
  // Channel-specific limits
  channelMessagesPerMinute: number;
  
  // Action-specific limits
  moderationActionsPerHour: number;
  
  // Burst protection
  burstWindowMs: number;
  burstLimit: number;
  
  // Penalties
  tempMuteMinutes: number;
  escalationThreshold: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  resetTime?: number;
  remainingRequests?: number;
  penaltyLevel: 'none' | 'warning' | 'temp_mute' | 'temp_ban';
}

interface UserRateData {
  messageCount: {
    minute: { count: number; resetTime: number };
    hour: { count: number; resetTime: number };
    day: { count: number; resetTime: number };
  };
  burstCount: { count: number; resetTime: number };
  violations: number;
  lastViolation: number;
  penaltyLevel: number;
}

interface ChannelRateData {
  messageCount: { count: number; resetTime: number };
}

export class RateLimiter {
  private logger: Logger;
  private db: DatabaseManager;
  private config: RateLimitConfig;
  
  // In-memory rate limit tracking
  private userLimits = new Map<string, UserRateData>();
  private channelLimits = new Map<string, ChannelRateData>();
  
  // Cleanup interval
  private cleanupInterval: NodeJS.Timeout;

  constructor(logger: Logger, db: DatabaseManager) {
    this.logger = logger;
    this.db = db;
    
    // Default configuration
    this.config = {
      messagesPerMinute: 20,
      messagesPerHour: 300,
      messagesPerDay: 2000,
      channelMessagesPerMinute: 50,
      moderationActionsPerHour: 10,
      burstWindowMs: 10000, // 10 seconds
      burstLimit: 5,
      tempMuteMinutes: 10,
      escalationThreshold: 3
    };

    // Start cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 5 * 60 * 1000);
  }

  /**
   * Configure rate limits
   */
  setConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Rate limiter configuration updated', { config: this.config });
  }

  /**
   * Check if a message is within rate limits
   */
  async checkMessageRateLimit(message: Message): Promise<RateLimitResult> {
    const userId = message.author.id;
    const channelId = message.channelId;
    const now = Date.now();

    try {
      // Get or create user data
      let userData = this.userLimits.get(userId);
      if (!userData) {
        userData = this.createUserData(now);
        this.userLimits.set(userId, userData);
      }

      // Get or create channel data
      let channelData = this.channelLimits.get(channelId);
      if (!channelData) {
        channelData = this.createChannelData(now);
        this.channelLimits.set(channelId, channelData);
      }

      // Check burst protection first
      const burstResult = this.checkBurstLimit(userData, now);
      if (!burstResult.allowed) {
        await this.handleViolation(userId, 'burst', message);
        return burstResult;
      }

      // Check user message limits
      const userResult = this.checkUserLimits(userData, now);
      if (!userResult.allowed) {
        await this.handleViolation(userId, 'user_limit', message);
        return userResult;
      }

      // Check channel limits
      const channelResult = this.checkChannelLimits(channelData, now);
      if (!channelResult.allowed) {
        await this.handleViolation(userId, 'channel_limit', message);
        return channelResult;
      }

      // All checks passed - increment counters
      this.incrementCounters(userData, channelData, now);

      return {
        allowed: true,
        penaltyLevel: 'none',
        remainingRequests: this.getRemainingRequests(userData, now)
      };

    } catch (error) {
      this.logger.error('Rate limit check error', {
        userId,
        channelId,
        error: String(error)
      });

      // Fail open - allow the message but log the error
      return {
        allowed: true,
        penaltyLevel: 'none',
        reason: 'Rate limit check failed'
      };
    }
  }

  /**
   * Check rate limits for moderation actions
   */
  async checkModerationActionRateLimit(userId: string): Promise<RateLimitResult> {
    const now = Date.now();
    
    try {
      // This would require a moderation_actions table in the database
      // For now, we'll use a simplified in-memory approach
      const userData = this.userLimits.get(userId);
      if (!userData) {
        return { allowed: true, penaltyLevel: 'none' };
      }

      // Simple check - if user has recent violations, limit their moderation actions
      if (userData.violations > 0 && (now - userData.lastViolation) < 60 * 60 * 1000) {
        return {
          allowed: false,
          reason: 'Too many recent rate limit violations',
          penaltyLevel: 'warning'
        };
      }

      return { allowed: true, penaltyLevel: 'none' };

    } catch (error) {
      this.logger.error('Moderation action rate limit check error', {
        userId,
        error: String(error)
      });

      return { allowed: true, penaltyLevel: 'none' };
    }
  }

  /**
   * Check burst protection
   */
  private checkBurstLimit(userData: UserRateData, now: number): RateLimitResult {
    const burstData = userData.burstCount;
    
    // Reset if window expired
    if (now - burstData.resetTime > this.config.burstWindowMs) {
      burstData.count = 0;
      burstData.resetTime = now;
    }

    if (burstData.count >= this.config.burstLimit) {
      return {
        allowed: false,
        reason: 'Burst limit exceeded',
        resetTime: burstData.resetTime + this.config.burstWindowMs,
        penaltyLevel: 'warning'
      };
    }

    return { allowed: true, penaltyLevel: 'none' };
  }

  /**
   * Check user rate limits
   */
  private checkUserLimits(userData: UserRateData, now: number): RateLimitResult {
    // Check minute limit
    const minuteData = userData.messageCount.minute;
    if (now - minuteData.resetTime > 60 * 1000) {
      minuteData.count = 0;
      minuteData.resetTime = now;
    }

    if (minuteData.count >= this.config.messagesPerMinute) {
      return {
        allowed: false,
        reason: 'Per-minute message limit exceeded',
        resetTime: minuteData.resetTime + 60 * 1000,
        penaltyLevel: this.getPenaltyLevel(userData.violations)
      };
    }

    // Check hour limit
    const hourData = userData.messageCount.hour;
    if (now - hourData.resetTime > 60 * 60 * 1000) {
      hourData.count = 0;
      hourData.resetTime = now;
    }

    if (hourData.count >= this.config.messagesPerHour) {
      return {
        allowed: false,
        reason: 'Per-hour message limit exceeded',
        resetTime: hourData.resetTime + 60 * 60 * 1000,
        penaltyLevel: this.getPenaltyLevel(userData.violations)
      };
    }

    // Check day limit
    const dayData = userData.messageCount.day;
    if (now - dayData.resetTime > 24 * 60 * 60 * 1000) {
      dayData.count = 0;
      dayData.resetTime = now;
    }

    if (dayData.count >= this.config.messagesPerDay) {
      return {
        allowed: false,
        reason: 'Daily message limit exceeded',
        resetTime: dayData.resetTime + 24 * 60 * 60 * 1000,
        penaltyLevel: this.getPenaltyLevel(userData.violations)
      };
    }

    return { allowed: true, penaltyLevel: 'none' };
  }

  /**
   * Check channel rate limits
   */
  private checkChannelLimits(channelData: ChannelRateData, now: number): RateLimitResult {
    const messageData = channelData.messageCount;
    
    // Reset if window expired
    if (now - messageData.resetTime > 60 * 1000) {
      messageData.count = 0;
      messageData.resetTime = now;
    }

    if (messageData.count >= this.config.channelMessagesPerMinute) {
      return {
        allowed: false,
        reason: 'Channel message limit exceeded',
        resetTime: messageData.resetTime + 60 * 1000,
        penaltyLevel: 'warning'
      };
    }

    return { allowed: true, penaltyLevel: 'none' };
  }

  /**
   * Increment all relevant counters
   */
  private incrementCounters(userData: UserRateData, channelData: ChannelRateData, _now: number): void {
    // Increment user counters
    userData.burstCount.count++;
    userData.messageCount.minute.count++;
    userData.messageCount.hour.count++;
    userData.messageCount.day.count++;

    // Increment channel counter
    channelData.messageCount.count++;
  }

  /**
   * Handle rate limit violations
   */
  private async handleViolation(userId: string, violationType: string, message: Message): Promise<void> {
    const now = Date.now();
    let userData = this.userLimits.get(userId);
    
    if (!userData) {
      userData = this.createUserData(now);
      this.userLimits.set(userId, userData);
    }

    // Increment violation count
    userData.violations++;
    userData.lastViolation = now;

    // Log the violation
    this.logger.warn('Rate limit violation', {
      userId,
      channelId: message.channelId,
      violationType,
      violations: userData.violations,
      penaltyLevel: this.getPenaltyLevel(userData.violations)
    });

    // Store in database for persistence
    try {
      await this.db.logRateLimitViolation(
        userId,
        message.channelId,
        violationType,
        userData.violations
      );
    } catch (error) {
      this.logger.error('Failed to log rate limit violation to database', {
        error: String(error)
      });
    }

    // Apply escalating penalties
    await this.applyPenalty(message, userData.violations);
  }

  /**
   * Apply penalties based on violation count
   */
  private async applyPenalty(message: Message, violations: number): Promise<void> {
    const penaltyLevel = this.getPenaltyLevel(violations);
    
    try {
      switch (penaltyLevel) {
        case 'warning':
          // Send a warning message (could be DM or channel)
          await message.reply('⚠️ You are sending messages too quickly. Please slow down.');
          break;
          
        case 'temp_mute':
          // Temporary mute - would need to be implemented with Discord permissions
          this.logger.info('User should be temporarily muted for rate limiting', {
            userId: message.author.id,
            duration: this.config.tempMuteMinutes
          });
          break;
          
        case 'temp_ban':
          // Temporary ban - would need to be implemented with Discord permissions
          this.logger.info('User should be temporarily banned for repeated rate limiting', {
            userId: message.author.id,
            violations
          });
          break;
      }
    } catch (error) {
      this.logger.error('Failed to apply rate limit penalty', {
        userId: message.author.id,
        penaltyLevel,
        error: String(error)
      });
    }
  }

  /**
   * Get penalty level based on violation count
   */
  private getPenaltyLevel(violations: number): RateLimitResult['penaltyLevel'] {
    if (violations === 0) return 'none';
    if (violations <= 2) return 'warning';
    if (violations <= 5) return 'temp_mute';
    return 'temp_ban';
  }

  /**
   * Get remaining requests for user
   */
  private getRemainingRequests(userData: UserRateData, _now: number): number {
    const minuteRemaining = Math.max(0, this.config.messagesPerMinute - userData.messageCount.minute.count);
    const hourRemaining = Math.max(0, this.config.messagesPerHour - userData.messageCount.hour.count);
    const dayRemaining = Math.max(0, this.config.messagesPerDay - userData.messageCount.day.count);
    
    return Math.min(minuteRemaining, hourRemaining, dayRemaining);
  }

  /**
   * Create new user data structure
   */
  private createUserData(now: number): UserRateData {
    return {
      messageCount: {
        minute: { count: 0, resetTime: now },
        hour: { count: 0, resetTime: now },
        day: { count: 0, resetTime: now }
      },
      burstCount: { count: 0, resetTime: now },
      violations: 0,
      lastViolation: 0,
      penaltyLevel: 0
    };
  }

  /**
   * Create new channel data structure
   */
  private createChannelData(now: number): ChannelRateData {
    return {
      messageCount: { count: 0, resetTime: now }
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Clean up user data older than 24 hours
    for (const [userId, userData] of this.userLimits.entries()) {
      const lastActivity = Math.max(
        userData.messageCount.minute.resetTime,
        userData.messageCount.hour.resetTime,
        userData.messageCount.day.resetTime,
        userData.burstCount.resetTime
      );
      
      if ((now - lastActivity) > dayMs) {
        this.userLimits.delete(userId);
      }
    }

    // Clean up channel data older than 1 hour
    const hourMs = 60 * 60 * 1000;
    for (const [channelId, channelData] of this.channelLimits.entries()) {
      if ((now - channelData.messageCount.resetTime) > hourMs) {
        this.channelLimits.delete(channelId);
      }
    }

    this.logger.debug('Rate limiter cleanup completed', {
      userEntries: this.userLimits.size,
      channelEntries: this.channelLimits.size
    });
  }

  /**
   * Get current rate limiter statistics
   */
  getStatistics(): {
    userEntries: number;
    channelEntries: number;
    totalViolations: number;
    memoryUsage: number;
  } {
    let totalViolations = 0;
    for (const userData of this.userLimits.values()) {
      totalViolations += userData.violations;
    }

    return {
      userEntries: this.userLimits.size,
      channelEntries: this.channelLimits.size,
      totalViolations,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    };
  }

  /**
   * Reset rate limits for a user (admin function)
   */
  resetUserLimits(userId: string): void {
    this.userLimits.delete(userId);
    this.logger.info('Rate limits reset for user', { userId });
  }

  /**
   * Clean up on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.userLimits.clear();
    this.channelLimits.clear();
  }
}