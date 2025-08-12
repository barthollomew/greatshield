/**
 * Jest test environment setup
 * Configures test database, mocks, and global test utilities
 */

import { beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';

// Global test database instance (in-memory)
let testDb: Database.Database;

// Setup before all tests
beforeAll(() => {
  // Create in-memory test database
  testDb = new Database(':memory:');
  
  // Initialize schema
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS policy_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    INSERT INTO policy_packs (name, description, is_active) VALUES
    ('Strict Moderation', 'Low tolerance policy pack', 0),
    ('Balanced Moderation', 'Moderate tolerance policy pack', 1),
    ('Lenient Moderation', 'High tolerance policy pack', 0);
    
    CREATE TABLE IF NOT EXISTS moderation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_pack_id INTEGER NOT NULL,
      rule_type TEXT NOT NULL,
      threshold REAL NOT NULL,
      action TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (policy_pack_id) REFERENCES policy_packs (id)
    );
    
    INSERT INTO moderation_rules (policy_pack_id, rule_type, threshold, action) VALUES
    (1, 'toxicity', 0.5, 'delete_warn'),
    (1, 'harassment', 0.6, 'timeout_1h'),
    (2, 'toxicity', 0.7, 'delete_warn'),
    (2, 'harassment', 0.8, 'timeout_1h'),
    (3, 'toxicity', 0.9, 'delete_warn'),
    (3, 'harassment', 0.9, 'timeout_1h');

    CREATE TABLE IF NOT EXISTS moderation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      message_content TEXT NOT NULL,
      detection_type TEXT NOT NULL,
      rule_triggered TEXT,
      confidence_scores TEXT,
      action_taken TEXT NOT NULL,
      reasoning TEXT,
      moderator_id TEXT,
      is_appeal INTEGER DEFAULT 0,
      appeal_reason TEXT,
      appeal_status TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS bot_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL UNIQUE,
      discord_token TEXT,
      application_id TEXT,
      public_key TEXT,
      selected_model TEXT,
      active_policy_pack_id INTEGER,
      mod_log_channel_id TEXT,
      ollama_host TEXT DEFAULT 'localhost',
      is_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (active_policy_pack_id) REFERENCES policy_packs (id)
    );
    
    CREATE TABLE IF NOT EXISTS message_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX idx_message_context_channel_timestamp ON message_context (channel_id, timestamp DESC);
    
    CREATE TABLE IF NOT EXISTS banned_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_pack_id INTEGER NOT NULL,
      word_or_phrase TEXT NOT NULL,
      is_regex INTEGER DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'medium',
      action TEXT NOT NULL DEFAULT 'delete_warn',
      FOREIGN KEY (policy_pack_id) REFERENCES policy_packs (id)
    );
    
    INSERT INTO banned_words (policy_pack_id, word_or_phrase, severity, action) VALUES
    (1, 'badword', 'high', 'delete_warn'),
    (2, 'spam', 'medium', 'timeout_1h');
    
    CREATE TABLE IF NOT EXISTS blocked_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_pack_id INTEGER NOT NULL,
      url_pattern TEXT NOT NULL,
      is_regex INTEGER DEFAULT 0,
      reason TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'delete_warn',
      FOREIGN KEY (policy_pack_id) REFERENCES policy_packs (id)
    );
    
    INSERT INTO blocked_urls (policy_pack_id, url_pattern, reason, action) VALUES
    (1, 'malicious-site.com', 'Known malicious domain', 'delete_warn');
  `);
  
  console.log('Test database initialized');
});

// Cleanup after all tests
afterAll(() => {
  if (testDb) {
    testDb.close();
  }
  console.log('Test database cleaned up');
});

// Setup before each test
beforeEach(() => {
  // Clear moderation logs for clean tests
  testDb.exec('DELETE FROM moderation_logs');
  testDb.exec('DELETE FROM message_context');
  testDb.exec('DELETE FROM bot_config');
});

// Cleanup after each test
afterEach(() => {
  // Additional cleanup if needed
});

// Export test database for use in tests
export { testDb };

// Mock Discord.js Client for testing
export const createMockDiscordClient = () => {
  return {
    user: { id: 'test-bot-id' },
    guilds: {
      cache: new Map(),
      fetch: jest.fn()
    },
    channels: {
      cache: new Map(),
      fetch: jest.fn()
    },
    on: jest.fn(),
    once: jest.fn(),
    login: jest.fn().mockResolvedValue('test-token'),
    destroy: jest.fn().mockResolvedValue(undefined)
  };
};

// Mock message object for testing
export const createMockMessage = (overrides: any = {}) => {
  return {
    id: 'test-message-id',
    content: 'Test message content',
    author: {
      id: 'test-user-id',
      bot: false
    },
    guild: {
      id: 'test-guild-id'
    },
    channel: {
      id: 'test-channel-id',
      send: jest.fn()
    },
    delete: jest.fn(),
    reply: jest.fn(),
    createdTimestamp: Date.now(),
    ...overrides
  };
};

// Mock moderation result
export const createMockModerationResult = (overrides: any = {}) => {
  return {
    toxicity: 0.1,
    harassment: 0.05,
    spam: 0.02,
    grooming: 0.01,
    action: 'allow' as const,
    reasoning: 'Content appears safe',
    ...overrides
  };
};