/**
 * GreatshieldBot Integration Tests
 * Tests integration scenarios using in-memory database and mocks
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { testDb, createMockMessage, createMockDiscordClient } from '../setup';

describe('GreatshieldBot Integration', () => {
  let mockClient: any;
  let testConfig: any;

  beforeEach(() => {
    // Clean up test data
    testDb.exec('DELETE FROM moderation_logs');
    testDb.exec('DELETE FROM message_context');
    testDb.exec('DELETE FROM bot_config');
    
    // Create mock Discord client
    mockClient = createMockDiscordClient();
    
    testConfig = {
      discord_token: 'test-token-123',
      guild_id: 'test-guild-456',
      selected_model: 'phi:2.7b',
      active_policy_pack_id: 1,
      mod_log_channel_id: 'mod-log-789',
      ollama_host: 'localhost'
    };
  });

  describe('Database Integration Flow', () => {
    test('should process complete moderation workflow', () => {
      // Step 1: Store bot configuration
      const configStmt = testDb.prepare(`
        INSERT INTO bot_config (guild_id, selected_model, active_policy_pack_id, is_enabled)
        VALUES (?, ?, ?, ?)
      `);
      const configResult = configStmt.run(testConfig.guild_id, testConfig.selected_model, testConfig.active_policy_pack_id, 1);
      expect(configResult.changes).toBe(1);

      // Step 2: Simulate message processing and logging
      const message = createMockMessage({
        content: 'This message needs moderation',
        guild: { id: testConfig.guild_id }
      });

      // Step 3: Store moderation result
      const logStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, message_content,
          detection_type, rule_triggered, action_taken, reasoning
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const logResult = logStmt.run(
        message.id,
        message.channel.id,
        testConfig.guild_id,
        message.author.id,
        message.content,
        'ai_analysis',
        'toxicity_threshold',
        'timeout_1h',
        'Content violated community guidelines'
      );
      expect(logResult.changes).toBe(1);

      // Step 4: Verify complete workflow was stored
      const verifyStmt = testDb.prepare(`
        SELECT ml.*, bc.selected_model, bc.active_policy_pack_id
        FROM moderation_logs ml
        JOIN bot_config bc ON ml.guild_id = bc.guild_id
        WHERE ml.message_id = ?
      `);
      const result = verifyStmt.get(message.id) as any;
      
      expect(result).toBeDefined();
      expect(result.action_taken).toBe('timeout_1h');
      expect(result.selected_model).toBe(testConfig.selected_model);
      expect(result.active_policy_pack_id).toBe(testConfig.active_policy_pack_id);
    });

    test('should handle message context alongside moderation', () => {
      const channelId = 'integration-channel';
      
      // Store message context (conversation history)
      const contextStmt = testDb.prepare(`
        INSERT INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const baseTime = Date.now();
      const messages = [
        'Hello everyone',
        'How are you doing?',
        'This might be problematic content'
      ];
      
      messages.forEach((content, index) => {
        contextStmt.run(
          channelId,
          `context-msg-${index}`,
          `user-${index}`,
          content,
          new Date(baseTime + index * 60000).toISOString()
        );
      });

      // Store moderation action for the problematic message
      const moderationStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, message_content,
          detection_type, action_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      moderationStmt.run(
        'context-msg-2',
        channelId,
        testConfig.guild_id,
        'user-2',
        'This might be problematic content',
        'ai_analysis',
        'delete_warn'
      );

      // Verify we can correlate context with moderation actions
      const correlationStmt = testDb.prepare(`
        SELECT 
          mc.content as context_content,
          ml.action_taken,
          ml.reasoning
        FROM message_context mc
        LEFT JOIN moderation_logs ml ON mc.message_id = ml.message_id
        WHERE mc.channel_id = ?
        ORDER BY mc.timestamp ASC
      `);
      
      const correlation = correlationStmt.all(channelId);
      expect(correlation).toHaveLength(3);
      expect((correlation[2] as any).action_taken).toBe('delete_warn');
    });

    test('should track policy effectiveness across messages', () => {
      const guildId = testConfig.guild_id;
      
      // Simulate multiple moderation events
      const moderationData = [
        { action: 'allow', detection: 'fast_pass', rule: null },
        { action: 'delete_warn', detection: 'ai_analysis', rule: 'toxicity_threshold' },
        { action: 'timeout_1h', detection: 'ai_analysis', rule: 'harassment_detection' },
        { action: 'allow', detection: 'fast_pass', rule: null },
        { action: 'delete_warn', detection: 'fast_pass', rule: 'banned_words' }
      ];
      
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, message_content,
          detection_type, rule_triggered, action_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      moderationData.forEach((data, index) => {
        insertStmt.run(
          `policy-test-${index}`,
          `channel-${index % 3}`,
          guildId,
          `user-${index}`,
          `Test message ${index}`,
          data.detection,
          data.rule,
          data.action
        );
      });

      // Analyze policy effectiveness
      const statsStmt = testDb.prepare(`
        SELECT 
          action_taken,
          detection_type,
          COUNT(*) as count
        FROM moderation_logs 
        WHERE guild_id = ?
        GROUP BY action_taken, detection_type
        ORDER BY count DESC
      `);
      
      const stats = statsStmt.all(guildId);
      expect(stats.length).toBeGreaterThan(0);
      
      const allowCount = (stats.find((s: any) => s.action_taken === 'allow') as any)?.count || 0;
      const actionCount = stats.reduce((sum: number, s: any) => {
        return s.action_taken !== 'allow' ? sum + s.count : sum;
      }, 0);
      
      expect(allowCount + actionCount).toBe(moderationData.length);
    });
  });

  describe('Bot Lifecycle Simulation', () => {
    test('should simulate bot startup and configuration', () => {
      const mockBot = {
        config: testConfig,
        client: mockClient,
        isReady: false,

        async initialize() {
          // Store configuration in database
          const stmt = testDb.prepare(`
            INSERT OR REPLACE INTO bot_config 
            (guild_id, discord_token, selected_model, active_policy_pack_id, is_enabled)
            VALUES (?, ?, ?, ?, ?)
          `);
          
          stmt.run(
            this.config.guild_id,
            this.config.discord_token,
            this.config.selected_model,
            this.config.active_policy_pack_id,
            1
          );
          return true;
        },

        async start() {
          await this.client.login(this.config.discord_token);
          this.isReady = true;
          return true;
        },

        getHealthStatus() {
          // Check database connectivity
          try {
            const stmt = testDb.prepare('SELECT COUNT(*) as count FROM policy_packs');
            const result = stmt.get() as { count: number };
            const dbReady = result.count > 0;
            
            return {
              botReady: this.isReady,
              dbReady,
              configValid: Boolean(this.config.guild_id && this.config.selected_model)
            };
          } catch (error) {
            return {
              botReady: false,
              dbReady: false,
              configValid: false,
              error: String(error)
            };
          }
        }
      };

      // Test initialization flow
      expect(mockBot.initialize()).resolves.toBe(true);
      
      // Verify configuration was stored
      const configStmt = testDb.prepare('SELECT * FROM bot_config WHERE guild_id = ?');
      const storedConfig = configStmt.get(testConfig.guild_id) as any;
      expect(storedConfig).toBeDefined();
      expect(storedConfig.selected_model).toBe(testConfig.selected_model);

      // Test health check
      const health = mockBot.getHealthStatus();
      expect(health.dbReady).toBe(true);
      expect(health.configValid).toBe(true);
    });

    test('should handle configuration updates during runtime', () => {
      // Initial configuration
      const initialStmt = testDb.prepare(`
        INSERT INTO bot_config (guild_id, selected_model, active_policy_pack_id)
        VALUES (?, ?, ?)
      `);
      initialStmt.run(testConfig.guild_id, 'phi:2.7b', 1);

      // Simulate configuration update
      const updateStmt = testDb.prepare(`
        UPDATE bot_config 
        SET selected_model = ?, active_policy_pack_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE guild_id = ?
      `);
      const updateResult = updateStmt.run('mistral:7b', 2, testConfig.guild_id);
      expect(updateResult.changes).toBe(1);

      // Verify update
      const verifyStmt = testDb.prepare('SELECT * FROM bot_config WHERE guild_id = ?');
      const updatedConfig = verifyStmt.get(testConfig.guild_id) as any;
      expect(updatedConfig.selected_model).toBe('mistral:7b');
      expect(updatedConfig.active_policy_pack_id).toBe(2);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle partial failures gracefully', () => {
      // Start a transaction that will partially succeed
      try {
        testDb.exec('BEGIN TRANSACTION');
        
        // This should succeed
        testDb.prepare(`
          INSERT INTO moderation_logs (
            message_id, channel_id, guild_id, user_id, message_content,
            detection_type, action_taken
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('success-msg', 'channel', 'guild', 'user', 'content', 'fast_pass', 'allow');
        
        // This should fail (duplicate message_id)
        testDb.prepare(`
          INSERT INTO moderation_logs (
            message_id, channel_id, guild_id, user_id, message_content,
            detection_type, action_taken
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('success-msg', 'channel', 'guild', 'user', 'content', 'fast_pass', 'allow');
        
        testDb.exec('COMMIT');
      } catch (error) {
        testDb.exec('ROLLBACK');
        expect(error).toBeDefined();
      }

      // Verify rollback worked - no records should exist
      const stmt = testDb.prepare('SELECT COUNT(*) as count FROM moderation_logs');
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(0);
    });

    test('should maintain data consistency under stress', () => {
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, message_content,
          detection_type, action_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // Simulate many concurrent operations
      const operations = [];
      for (let i = 0; i < 50; i++) {
        operations.push(() => {
          return insertStmt.run(
            `stress-msg-${i}`,
            'stress-channel',
            'stress-guild',
            `user-${i % 5}`,
            `Stress test message ${i}`,
            i % 2 === 0 ? 'fast_pass' : 'ai_analysis',
            i % 3 === 0 ? 'delete_warn' : 'allow'
          );
        });
      }

      // Execute all operations
      const results = operations.map(op => op());
      expect(results.length).toBe(50);
      expect(results.every(r => r.changes === 1)).toBe(true);

      // Verify all records were inserted
      const countStmt = testDb.prepare('SELECT COUNT(*) as count FROM moderation_logs');
      const count = countStmt.get() as { count: number };
      expect(count.count).toBe(50);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large datasets efficiently', () => {
      const channelId = 'perf-channel';
      const insertStmt = testDb.prepare(`
        INSERT INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);

      // Insert large number of context messages
      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        insertStmt.run(
          channelId,
          `perf-msg-${i}`,
          `user-${i % 20}`,
          `Performance test message ${i}`,
          new Date(startTime + i * 1000).toISOString()
        );
      }

      // Test query performance
      const queryStart = Date.now();
      const selectStmt = testDb.prepare(`
        SELECT user_id, content, timestamp 
        FROM message_context 
        WHERE channel_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 50
      `);
      const results = selectStmt.all(channelId);
      const queryDuration = Date.now() - queryStart;

      expect(results).toHaveLength(50);
      expect(queryDuration).toBeLessThan(100); // Should be fast even with 1000 records
    });

    test('should optimize moderation log queries', () => {
      const guildId = 'optimization-guild';
      const insertStmt = testDb.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, message_content,
          detection_type, action_taken, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Insert logs with different timestamps
      const baseTime = Date.now();
      for (let i = 0; i < 500; i++) {
        insertStmt.run(
          `opt-msg-${i}`,
          `channel-${i % 10}`,
          guildId,
          `user-${i % 25}`,
          `Optimization test message ${i}`,
          i % 2 === 0 ? 'fast_pass' : 'ai_analysis',
          i % 4 === 0 ? 'delete_warn' : 'allow',
          new Date(baseTime + i * 60000).toISOString() // 1 minute apart
        );
      }

      // Test complex aggregation query performance
      const queryStart = Date.now();
      const statsStmt = testDb.prepare(`
        SELECT 
          guild_id,
          action_taken,
          detection_type,
          COUNT(*) as count,
          AVG(CASE WHEN action_taken != 'allow' THEN 1 ELSE 0 END) as action_rate
        FROM moderation_logs 
        WHERE guild_id = ? 
          AND processed_at > datetime('now', '-24 hours')
        GROUP BY guild_id, action_taken, detection_type
        ORDER BY count DESC
      `);
      const stats = statsStmt.all(guildId);
      const queryDuration = Date.now() - queryStart;

      expect(stats.length).toBeGreaterThan(0);
      expect(queryDuration).toBeLessThan(200); // Complex query should still be fast
    });
  });
});