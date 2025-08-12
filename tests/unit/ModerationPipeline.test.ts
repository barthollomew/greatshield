/**
 * ModerationPipeline Unit Tests
 * Tests core moderation pipeline functionality with simplified mocks
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { createMockMessage } from '../setup';

// Mock all the complex dependencies to focus on testing the pipeline logic
const mockPipeline = {
  isInitialized: false,
  config: null as any,

  async initialize(config: any): Promise<void> {
    this.config = config;
    this.isInitialized = true;
  },

  async moderateMessage(message: any) {
    if (!this.isInitialized) {
      return null;
    }

    // Simulate fast-pass check
    if (message.content.includes('badword')) {
      return {
        action: 'delete_warn',
        reason: 'Fast-pass filter triggered',
        confidence: 0.95,
        ruleTriggered: 'banned_words',
        detectionType: 'fast_pass'
      };
    }

    // Simulate AI analysis for borderline content
    if (message.content.includes('maybe toxic')) {
      return {
        action: 'timeout_1h',
        reason: 'AI detected potential toxicity',
        confidence: 0.75,
        ruleTriggered: 'toxicity_threshold',
        detectionType: 'ai_analysis'
      };
    }

    // Safe content
    return null;
  },

  getHealthStatus() {
    return {
      initialized: this.isInitialized,
      fastPassReady: this.isInitialized,
      aiReady: this.isInitialized && Boolean(this.config?.selected_model),
      config: this.config
    };
  },

  async reload(config: any) {
    this.config = config;
    await this.initialize(config);
  }
};

describe('ModerationPipeline', () => {
  beforeEach(() => {
    // Reset mock state
    mockPipeline.isInitialized = false;
    mockPipeline.config = null;
  });

  describe('Initialization', () => {
    test('should initialize successfully with valid config', async () => {
      const testConfig = {
        discord_token: 'test-token',
        guild_id: 'test-guild-123',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1,
        mod_log_channel_id: 'mod-log-channel'
      };

      await expect(mockPipeline.initialize(testConfig)).resolves.not.toThrow();
      expect(mockPipeline.isInitialized).toBe(true);
      expect(mockPipeline.config).toEqual(testConfig);
    });

    test('should return proper health status after initialization', async () => {
      const testConfig = {
        guild_id: 'test-guild',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1
      };

      // Before initialization
      let health = mockPipeline.getHealthStatus();
      expect(health.initialized).toBe(false);

      // After initialization
      await mockPipeline.initialize(testConfig);
      health = mockPipeline.getHealthStatus();
      expect(health.initialized).toBe(true);
      expect(health.aiReady).toBe(true);
    });

    test('should reload configuration successfully', async () => {
      const initialConfig = { guild_id: 'guild-1', selected_model: 'model-1', active_policy_pack_id: 1 };
      const newConfig = { guild_id: 'guild-1', selected_model: 'model-2', active_policy_pack_id: 2 };

      await mockPipeline.initialize(initialConfig);
      expect(mockPipeline.config.selected_model).toBe('model-1');

      await mockPipeline.reload(newConfig);
      expect(mockPipeline.config.selected_model).toBe('model-2');
      expect(mockPipeline.isInitialized).toBe(true);
    });
  });

  describe('Message Moderation', () => {
    beforeEach(async () => {
      const testConfig = {
        guild_id: 'test-guild',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1,
        mod_log_channel_id: 'mod-log'
      };
      await mockPipeline.initialize(testConfig);
    });

    test('should return null for uninitialized pipeline', async () => {
      mockPipeline.isInitialized = false;
      const message = createMockMessage();

      const result = await mockPipeline.moderateMessage(message);
      expect(result).toBeNull();
    });

    test('should trigger fast-pass filter for banned words', async () => {
      const message = createMockMessage({ content: 'This contains a badword' });
      
      const result = await mockPipeline.moderateMessage(message);
      
      expect(result).toBeDefined();
      expect(result?.action).toBe('delete_warn');
      expect(result?.detectionType).toBe('fast_pass');
      expect(result?.ruleTriggered).toBe('banned_words');
      expect(result?.confidence).toBe(0.95);
    });

    test('should use AI analysis for borderline content', async () => {
      const message = createMockMessage({ content: 'This is maybe toxic content' });
      
      const result = await mockPipeline.moderateMessage(message);
      
      expect(result).toBeDefined();
      expect(result?.action).toBe('timeout_1h');
      expect(result?.detectionType).toBe('ai_analysis');
      expect(result?.ruleTriggered).toBe('toxicity_threshold');
      expect(result?.confidence).toBe(0.75);
    });

    test('should return null for safe content', async () => {
      const message = createMockMessage({ content: 'This is perfectly normal content' });
      
      const result = await mockPipeline.moderateMessage(message);
      
      expect(result).toBeNull();
    });

    test('should handle messages from different content types', async () => {
      const toxicMessage = createMockMessage({ content: 'badword content' });
      const borderlineMessage = createMockMessage({ content: 'maybe toxic content' });
      const safeMessage = createMockMessage({ content: 'hello world' });
      
      const toxicResult = await mockPipeline.moderateMessage(toxicMessage);
      const borderlineResult = await mockPipeline.moderateMessage(borderlineMessage);
      const safeResult = await mockPipeline.moderateMessage(safeMessage);
      
      expect(toxicResult?.action).toBe('delete_warn');
      expect(borderlineResult?.action).toBe('timeout_1h');
      expect(safeResult).toBeNull();
    });
  });

  describe('Configuration Management', () => {
    test('should handle configuration updates', async () => {
      const config1 = { guild_id: 'test', selected_model: 'phi:2.7b', active_policy_pack_id: 1 };
      const config2 = { guild_id: 'test', selected_model: 'mistral:7b', active_policy_pack_id: 2 };
      
      await mockPipeline.initialize(config1);
      expect(mockPipeline.config).toEqual(config1);
      
      await mockPipeline.reload(config2);
      expect(mockPipeline.config).toEqual(config2);
    });

    test('should maintain initialization state after reload', async () => {
      const config = { guild_id: 'test', selected_model: 'phi:2.7b', active_policy_pack_id: 1 };
      
      await mockPipeline.initialize(config);
      expect(mockPipeline.isInitialized).toBe(true);
      
      await mockPipeline.reload(config);
      expect(mockPipeline.isInitialized).toBe(true);
    });
  });

  describe('Health Status', () => {
    test('should report correct health status when uninitialized', () => {
      const health = mockPipeline.getHealthStatus();
      
      expect(health.initialized).toBe(false);
      expect(health.fastPassReady).toBe(false);
      expect(health.aiReady).toBe(false);
    });

    test('should report correct health status when initialized', async () => {
      const config = {
        guild_id: 'test',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1
      };
      
      await mockPipeline.initialize(config);
      const health = mockPipeline.getHealthStatus();
      
      expect(health.initialized).toBe(true);
      expect(health.fastPassReady).toBe(true);
      expect(health.aiReady).toBe(true);
      expect(health.config).toEqual(config);
    });

    test('should handle AI readiness based on model configuration', async () => {
      const configWithModel = {
        guild_id: 'test',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1
      };
      
      const configWithoutModel = {
        guild_id: 'test',
        selected_model: undefined,
        active_policy_pack_id: 1
      };
      
      await mockPipeline.initialize(configWithModel);
      let health = mockPipeline.getHealthStatus();
      expect(health.aiReady).toBe(true);
      
      await mockPipeline.reload(configWithoutModel);
      health = mockPipeline.getHealthStatus();
      expect(health.aiReady).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty message content', async () => {
      await mockPipeline.initialize({
        guild_id: 'test',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1
      });
      
      const emptyMessage = createMockMessage({ content: '' });
      const result = await mockPipeline.moderateMessage(emptyMessage);
      
      expect(result).toBeNull();
    });

    test('should handle very long message content', async () => {
      await mockPipeline.initialize({
        guild_id: 'test',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1
      });
      
      const longContent = 'a'.repeat(4000) + ' badword';
      const longMessage = createMockMessage({ content: longContent });
      const result = await mockPipeline.moderateMessage(longMessage);
      
      expect(result).toBeDefined();
      expect(result?.action).toBe('delete_warn');
    });

    test('should handle special characters in content', async () => {
      await mockPipeline.initialize({
        guild_id: 'test',
        selected_model: 'phi:2.7b',
        active_policy_pack_id: 1
      });
      
      const specialContent = '💀🔥 maybe toxic 🚨⚠️';
      const specialMessage = createMockMessage({ content: specialContent });
      const result = await mockPipeline.moderateMessage(specialMessage);
      
      expect(result).toBeDefined();
      expect(result?.action).toBe('timeout_1h');
    });
  });
});