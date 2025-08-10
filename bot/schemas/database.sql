-- Greatshield Database Schema
-- SQLite database for storing moderation policies, logs, and user data

-- Policy Packs Table
CREATE TABLE IF NOT EXISTS policy_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Moderation Rules Table
CREATE TABLE IF NOT EXISTS moderation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_pack_id INTEGER NOT NULL,
    rule_type TEXT NOT NULL, -- 'toxicity', 'harassment', 'spam', 'grooming'
    threshold REAL NOT NULL DEFAULT 0.7, -- 0.0 to 1.0 confidence threshold
    action TEXT NOT NULL, -- 'mask', 'delete_warn', 'shadowban', 'escalate'
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_pack_id) REFERENCES policy_packs(id) ON DELETE CASCADE
);

-- Banned Words/Phrases Table
CREATE TABLE IF NOT EXISTS banned_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_pack_id INTEGER NOT NULL,
    word_or_phrase TEXT NOT NULL,
    is_regex BOOLEAN DEFAULT FALSE,
    severity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    action TEXT NOT NULL DEFAULT 'mask', -- 'mask', 'delete_warn', 'shadowban', 'escalate'
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_pack_id) REFERENCES policy_packs(id) ON DELETE CASCADE
);

-- URL Blocklist Table
CREATE TABLE IF NOT EXISTS blocked_urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_pack_id INTEGER NOT NULL,
    url_pattern TEXT NOT NULL,
    is_regex BOOLEAN DEFAULT FALSE,
    reason TEXT,
    action TEXT NOT NULL DEFAULT 'delete_warn',
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_pack_id) REFERENCES policy_packs(id) ON DELETE CASCADE
);

-- Moderation Logs Table
CREATE TABLE IF NOT EXISTS moderation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    message_content TEXT,
    detection_type TEXT NOT NULL, -- 'fast_pass', 'ai_analysis'
    rule_triggered TEXT, -- which rule was triggered
    confidence_scores TEXT, -- JSON object with scores
    action_taken TEXT NOT NULL,
    reasoning TEXT,
    moderator_id TEXT, -- if manual action
    is_appeal BOOLEAN DEFAULT FALSE,
    appeal_reason TEXT,
    appeal_status TEXT, -- 'pending', 'approved', 'rejected'
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Violations Table
CREATE TABLE IF NOT EXISTS user_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    violation_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message_id TEXT,
    violation_count INTEGER DEFAULT 1,
    last_violation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_shadowbanned BOOLEAN DEFAULT FALSE,
    shadowban_expires TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bot Configuration Table
CREATE TABLE IF NOT EXISTS bot_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL UNIQUE,
    discord_token TEXT,
    application_id TEXT,
    public_key TEXT,
    mod_log_channel_id TEXT,
    selected_model TEXT DEFAULT 'phi:2.7b-q4_k_m',
    ollama_host TEXT DEFAULT 'http://localhost:11434',
    active_policy_pack_id INTEGER,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (active_policy_pack_id) REFERENCES policy_packs(id)
);

-- Message Context Table (for RAG)
CREATE TABLE IF NOT EXISTS message_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    is_moderated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Model Performance Stats Table
CREATE TABLE IF NOT EXISTS model_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT NOT NULL,
    total_inferences INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER DEFAULT 0,
    accuracy_score REAL DEFAULT 0.0,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_moderation_logs_user_id ON moderation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_guild_id ON moderation_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_processed_at ON moderation_logs(processed_at);
CREATE INDEX IF NOT EXISTS idx_user_violations_user_guild ON user_violations(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_message_context_channel ON message_context(channel_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_banned_words_policy_pack ON banned_words(policy_pack_id, enabled);
CREATE INDEX IF NOT EXISTS idx_blocked_urls_policy_pack ON blocked_urls(policy_pack_id, enabled);