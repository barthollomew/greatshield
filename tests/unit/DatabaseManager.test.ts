/**
 * DatabaseManager Unit Tests
 * Tests database operations using the shared in-memory test database
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { testDb } from '../setup';

describe('DatabaseManager', () => {
  beforeEach(() => {
    // Clean up test data before each test
    testDb.exec('DELETE FROM moderation_logs');
    testDb.exec('DELETE FROM message_context');
    testDb.exec('DELETE FROM bot_config');
  });

  describe('Database Schema and Setup', () => {
    test('should have policy packs table with data', () => {
      const stmt = testDb.prepare('SELECT COUNT(*) as count FROM policy_packs');
      const result = stmt.get() as { count: number };
      expect(result.count).toBeGreaterThan(0);
    });

    test('should have moderation rules table with data', () => {
      const stmt = testDb.prepare('SELECT COUNT(*) as count FROM moderation_rules');
      const result = stmt.get() as { count: number };
      expect(result.count).toBeGreaterThan(0);
    });

    test('should have empty moderation logs table initially', () => {
      const stmt = testDb.prepare('SELECT COUNT(*) as count FROM moderation_logs');
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(0);
    });
  });

  describe('Policy Pack Operations', () => {
    test('should retrieve policy packs', () => {
      const stmt = testDb.prepare('SELECT * FROM policy_packs');
      const policyPacks = stmt.all();
      
      expect(Array.isArray(policyPacks)).toBe(true);
      expect(policyPacks.length).toBeGreaterThan(0);
      expect(policyPacks[0]).toHaveProperty('name');
      expect(policyPacks[0]).toHaveProperty('description');
    });

    test('should get active policy pack', () => {
      const stmt = testDb.prepare('SELECT * FROM policy_packs WHERE is_active = 1');
      const activePack = stmt.get();
      
      expect(activePack).toBeDefined();
      expect(activePack).toHaveProperty('name');
      expect((activePack as any).is_active).toBe(1);
    });

    test('should update active policy pack', () => {
      // First, get a policy pack ID
      const getStmt = testDb.prepare('SELECT id FROM policy_packs LIMIT 1');
      const pack = getStmt.get() as { id: number };
      
      // Set it as active
      testDb.prepare('UPDATE policy_packs SET is_active = 0').run();
      const updateStmt = testDb.prepare('UPDATE policy_packs SET is_active = 1 WHERE id = ?');
      updateStmt.run(pack.id);
      
      // Verify it's active
      const verifyStmt = testDb.prepare('SELECT * FROM policy_packs WHERE is_active = 1');
      const activePack = verifyStmt.get() as { id: number };
      expect(activePack.id).toBe(pack.id);
    });
  });

  describe('Moderation Rules', () => {
    test('should get moderation rules for policy pack', () => {
      const stmt = testDb.prepare('SELECT * FROM moderation_rules WHERE policy_pack_id = ?');
      const rules = stmt.all(1);
      
      expect(Array.isArray(rules)).toBe(true);
      if (rules.length > 0) {
        expect(rules[0]).toHaveProperty('rule_type');
        expect(rules[0]).toHaveProperty('threshold');
        expect(rules[0]).toHaveProperty('action');
      }
    });

    test('should handle non-existent policy pack ID', () => {
      const stmt = testDb.prepare('SELECT * FROM moderation_rules WHERE policy_pack_id = ?');
      const rules = stmt.all(999999);
      expect(rules).toHaveLength(0);
    });
  });

  describe('Moderation Logs', () => {
    test('should insert moderation log', () => {
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, message_content,
          detection_type, action_taken, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = insertStmt.run(
        'test-msg-123',
        'test-channel-456',
        'test-guild-789',
        'test-user-101',
        'Test message content',
        'fast_pass',
        'delete_warn',
        new Date().toISOString()
      );
      
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeDefined();
    });

    test('should retrieve moderation log by message ID', () => {
      // Insert a test log
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, message_content,
          detection_type, action_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertStmt.run(
        'retrieve-test-msg',
        'test-channel',
        'test-guild',
        'test-user',
        'Test retrieval message',
        'ai_analysis',
        'timeout_1h'
      );
      
      // Retrieve it
      const selectStmt = testDb.prepare('SELECT * FROM moderation_logs WHERE message_id = ?');
      const log = selectStmt.get('retrieve-test-msg') as any;
      
      expect(log).toBeDefined();
      expect(log.message_id).toBe('retrieve-test-msg');
      expect(log.action_taken).toBe('timeout_1h');
      expect(log.detection_type).toBe('ai_analysis');
    });

    test('should return undefined for non-existent message ID', () => {
      const stmt = testDb.prepare('SELECT * FROM moderation_logs WHERE message_id = ?');
      const log = stmt.get('non-existent-message');
      expect(log).toBeUndefined();
    });

    test('should store complete moderation log with all fields', () => {
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, username, message_content,
          detection_type, rule_triggered, confidence_scores, action_taken,
          reasoning, moderator_id, is_appeal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = insertStmt.run(
        'complete-log-test',
        'complete-channel',
        'complete-guild',
        'complete-user',
        'testuser',
        'Complete test message',
        'ai_analysis',
        'harassment_detection',
        JSON.stringify({ toxicity: 0.75, harassment: 0.85 }),
        'shadowban',
        'Repeated harassment behavior',
        'moderator-123',
        0
      );
      
      expect(result.changes).toBe(1);
      
      // Verify all fields were stored
      const selectStmt = testDb.prepare('SELECT * FROM moderation_logs WHERE message_id = ?');
      const log = selectStmt.get('complete-log-test') as any;
      
      expect(log.username).toBe('testuser');
      expect(log.rule_triggered).toBe('harassment_detection');
      expect(log.reasoning).toBe('Repeated harassment behavior');
      expect(log.moderator_id).toBe('moderator-123');
      expect(log.is_appeal).toBe(0);
    });
  });

  describe('Bot Configuration', () => {
    test('should insert bot configuration', () => {
      const insertStmt = testDb.prepare(`
        INSERT INTO bot_config (
          guild_id, discord_token, selected_model, active_policy_pack_id,
          mod_log_channel_id, ollama_host, is_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = insertStmt.run(
        'test-guild-config',
        'test-token',
        'phi:2.7b',
        1,
        'mod-log-channel',
        'localhost',
        1
      );
      
      expect(result.changes).toBe(1);
    });

    test('should retrieve bot configuration by guild ID', () => {
      // Insert config
      const insertStmt = testDb.prepare(`
        INSERT INTO bot_config (guild_id, selected_model, active_policy_pack_id)
        VALUES (?, ?, ?)
      `);
      insertStmt.run('retrieve-guild', 'mistral:7b', 2);
      
      // Retrieve config
      const selectStmt = testDb.prepare('SELECT * FROM bot_config WHERE guild_id = ?');
      const config = selectStmt.get('retrieve-guild') as any;
      
      expect(config).toBeDefined();
      expect(config.guild_id).toBe('retrieve-guild');
      expect(config.selected_model).toBe('mistral:7b');
      expect(config.active_policy_pack_id).toBe(2);
    });

    test('should update existing bot configuration', () => {
      // Insert initial config
      const insertStmt = testDb.prepare(`
        INSERT INTO bot_config (guild_id, selected_model) VALUES (?, ?)
      `);
      insertStmt.run('update-guild', 'phi:2.7b');
      
      // Update config
      const updateStmt = testDb.prepare(`
        UPDATE bot_config SET selected_model = ?, active_policy_pack_id = ?
        WHERE guild_id = ?
      `);
      const result = updateStmt.run('mistral:7b', 3, 'update-guild');
      expect(result.changes).toBe(1);
      
      // Verify update
      const selectStmt = testDb.prepare('SELECT * FROM bot_config WHERE guild_id = ?');
      const config = selectStmt.get('update-guild') as any;
      expect(config.selected_model).toBe('mistral:7b');
      expect(config.active_policy_pack_id).toBe(3);
    });
  });

  describe('Message Context', () => {
    test('should store message context', () => {
      const insertStmt = testDb.prepare(`
        INSERT INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const result = insertStmt.run(
        'context-channel',
        'context-msg',
        'context-user',
        'Context message content',
        new Date().toISOString()
      );
      
      expect(result.changes).toBe(1);
    });

    test('should retrieve recent message context', () => {
      const channelId = 'recent-context-channel';
      const insertStmt = testDb.prepare(`
        INSERT INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      // Insert multiple messages
      const baseTime = new Date();
      for (let i = 0; i < 5; i++) {
        const timestamp = new Date(baseTime.getTime() + i * 1000);
        insertStmt.run(
          channelId,
          `msg-${i}`,
          `user-${i}`,
          `Message ${i}`,
          timestamp.toISOString()
        );
      }
      
      // Retrieve recent context
      const selectStmt = testDb.prepare(`
        SELECT user_id, content, timestamp FROM message_context 
        WHERE channel_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `);
      const context = selectStmt.all(channelId, 3);
      
      expect(context).toHaveLength(3);
      expect(context[0]).toHaveProperty('content');
      expect(context[0]).toHaveProperty('user_id');
    });
  });

  describe('Banned Words and Blocked URLs', () => {
    test('should retrieve banned words for policy pack', () => {
      const stmt = testDb.prepare('SELECT * FROM banned_words WHERE policy_pack_id = ?');
      const bannedWords = stmt.all(1);
      
      expect(Array.isArray(bannedWords)).toBe(true);
      if (bannedWords.length > 0) {
        expect(bannedWords[0]).toHaveProperty('word_or_phrase');
        expect(bannedWords[0]).toHaveProperty('severity');
        expect(bannedWords[0]).toHaveProperty('action');
      }
    });

    test('should retrieve blocked URLs for policy pack', () => {
      const stmt = testDb.prepare('SELECT * FROM blocked_urls WHERE policy_pack_id = ?');
      const blockedUrls = stmt.all(1);
      
      expect(Array.isArray(blockedUrls)).toBe(true);
      if (blockedUrls.length > 0) {
        expect(blockedUrls[0]).toHaveProperty('url_pattern');
        expect(blockedUrls[0]).toHaveProperty('reason');
        expect(blockedUrls[0]).toHaveProperty('action');
      }
    });

    test('should return empty array for non-existent policy pack', () => {
      const wordsStmt = testDb.prepare('SELECT * FROM banned_words WHERE policy_pack_id = ?');
      const urlsStmt = testDb.prepare('SELECT * FROM blocked_urls WHERE policy_pack_id = ?');
      
      const words = wordsStmt.all(999999);
      const urls = urlsStmt.all(999999);
      
      expect(words).toHaveLength(0);
      expect(urls).toHaveLength(0);
    });
  });

  describe('Data Integrity and Constraints', () => {
    test('should enforce unique message_id constraint', () => {
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_logs (message_id, channel_id, guild_id, user_id, message_content, detection_type, action_taken)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      // First insert should succeed
      const result1 = insertStmt.run('unique-msg', 'channel', 'guild', 'user', 'content', 'fast_pass', 'allow');
      expect(result1.changes).toBe(1);
      
      // Second insert with same message_id should fail
      expect(() => {
        insertStmt.run('unique-msg', 'channel', 'guild', 'user', 'content', 'fast_pass', 'allow');
      }).toThrow();
    });

    test('should enforce unique guild_id constraint in bot_config', () => {
      const insertStmt = testDb.prepare(`
        INSERT INTO bot_config (guild_id, selected_model) VALUES (?, ?)
      `);
      
      // First insert should succeed
      const result1 = insertStmt.run('unique-guild', 'phi:2.7b');
      expect(result1.changes).toBe(1);
      
      // Second insert with same guild_id should fail
      expect(() => {
        insertStmt.run('unique-guild', 'mistral:7b');
      }).toThrow();
    });

    test('should handle foreign key relationships', () => {
      // Insert a moderation rule with valid policy_pack_id
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_rules (policy_pack_id, rule_type, threshold, action)
        VALUES (?, ?, ?, ?)
      `);
      
      // This should succeed (policy_pack_id 1 exists)
      const result = insertStmt.run(1, 'custom_rule', 0.8, 'warn');
      expect(result.changes).toBe(1);
    });
  });

  describe('Performance and Indexing', () => {
    test('should efficiently query message context with index', () => {
      const channelId = 'perf-test-channel';
      const insertStmt = testDb.prepare(`
        INSERT INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      // Insert many messages
      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        insertStmt.run(
          channelId,
          `perf-msg-${i}`,
          `user-${i % 10}`,
          `Performance test message ${i}`,
          new Date(startTime + i * 1000).toISOString()
        );
      }
      
      // Query should be fast due to index
      const queryStart = Date.now();
      const selectStmt = testDb.prepare(`
        SELECT * FROM message_context 
        WHERE channel_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 10
      `);
      const results = selectStmt.all(channelId);
      const queryDuration = Date.now() - queryStart;
      
      expect(results).toHaveLength(10);
      expect(queryDuration).toBeLessThan(50); // Should be very fast
    });
  });
});