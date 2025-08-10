-- Seed data for Greatshield database
-- Default policy packs and example configurations

-- Default Policy Pack: Strict Moderation
INSERT OR IGNORE INTO policy_packs (name, description, is_active) VALUES 
('Strict Moderation', 'High-security moderation with low tolerance for violations', 1),
('Balanced Moderation', 'Moderate approach balancing community freedom with safety', 0),
('Lenient Moderation', 'Light-touch moderation focusing only on severe violations', 0);

-- Default Moderation Rules for Strict Policy Pack
INSERT OR IGNORE INTO moderation_rules (policy_pack_id, rule_type, threshold, action, enabled) VALUES 
(1, 'toxicity', 0.6, 'delete_warn', 1),
(1, 'harassment', 0.5, 'delete_warn', 1),
(1, 'spam', 0.7, 'mask', 1),
(1, 'grooming', 0.3, 'escalate', 1);

-- Default Moderation Rules for Balanced Policy Pack
INSERT OR IGNORE INTO moderation_rules (policy_pack_id, rule_type, threshold, action, enabled) VALUES 
(2, 'toxicity', 0.75, 'mask', 1),
(2, 'harassment', 0.7, 'delete_warn', 1),
(2, 'spam', 0.8, 'mask', 1),
(2, 'grooming', 0.4, 'escalate', 1);

-- Default Moderation Rules for Lenient Policy Pack
INSERT OR IGNORE INTO moderation_rules (policy_pack_id, rule_type, threshold, action, enabled) VALUES 
(3, 'toxicity', 0.9, 'mask', 1),
(3, 'harassment', 0.85, 'delete_warn', 1),
(3, 'spam', 0.9, 'mask', 1),
(3, 'grooming', 0.5, 'escalate', 1);

-- Common Banned Words for Strict Policy Pack
INSERT OR IGNORE INTO banned_words (policy_pack_id, word_or_phrase, is_regex, severity, action, enabled) VALUES 
(1, '(?i)\\b(f[u*]+ck|sh[i*]+t|damn|hell)\\b', 1, 'low', 'mask', 1),
(1, '(?i)\\b(b[i*]+tch|wh[o*]+re|sl[u*]+t)\\b', 1, 'medium', 'delete_warn', 1),
(1, '(?i)\\b(n[i*]+gg[e3a*]+r|f[a*]+gg[o*]+t)\\b', 1, 'critical', 'escalate', 1),
(1, '(?i)\\b(kill\\s+yourself|kys)\\b', 1, 'high', 'escalate', 1),
(1, '(?i)\\b(discord\\.gg/|invite\\.gg/)\\w+', 1, 'medium', 'delete_warn', 1);

-- Common Blocked URLs for all policy packs
INSERT OR IGNORE INTO blocked_urls (policy_pack_id, url_pattern, is_regex, reason, action, enabled) VALUES 
(1, '(?i)https?://(?:www\\.)?(bit\\.ly|tinyurl\\.com|t\\.co)/', 1, 'URL shorteners often used for malicious links', 'delete_warn', 1),
(1, '(?i)https?://(?:www\\.)?(grabify\\.link|iplogger\\.org)', 1, 'IP grabbing services', 'escalate', 1),
(1, '(?i)https?://(?:www\\.)?discord\\.gg/(?!your-server-code)', 1, 'Unauthorized Discord invites', 'delete_warn', 1);

-- Mirror banned words and URLs for other policy packs (less restrictive)
INSERT OR IGNORE INTO banned_words (policy_pack_id, word_or_phrase, is_regex, severity, action, enabled) VALUES 
(2, '(?i)\\b(n[i*]+gg[e3a*]+r|f[a*]+gg[o*]+t)\\b', 1, 'critical', 'escalate', 1),
(2, '(?i)\\b(kill\\s+yourself|kys)\\b', 1, 'high', 'delete_warn', 1),
(3, '(?i)\\b(n[i*]+gg[e3a*]+r|f[a*]+gg[o*]+t)\\b', 1, 'critical', 'delete_warn', 1),
(3, '(?i)\\b(kill\\s+yourself|kys)\\b', 1, 'high', 'mask', 1);

INSERT OR IGNORE INTO blocked_urls (policy_pack_id, url_pattern, is_regex, reason, action, enabled) VALUES 
(2, '(?i)https?://(?:www\\.)?(grabify\\.link|iplogger\\.org)', 1, 'IP grabbing services', 'escalate', 1),
(3, '(?i)https?://(?:www\\.)?(grabify\\.link|iplogger\\.org)', 1, 'IP grabbing services', 'delete_warn', 1);

-- Example bot configuration (will be updated by CLI wizard)
INSERT OR IGNORE INTO bot_config (guild_id, application_id, public_key, selected_model, active_policy_pack_id) VALUES 
('example_guild_id', '1403985306021269656', 'dc0a734ee5cb3466145f780311fea17d88685c89d41dcd3f5dacc58c63a2a25c', 'phi:2.7b-q4_k_m', 1);