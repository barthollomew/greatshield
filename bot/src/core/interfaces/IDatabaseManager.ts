import {
  PolicyPack,
  ModerationRule,
  ModerationLog,
  BotConfig
} from '../../database/DatabaseManager';

export interface IDatabaseManager {
  initialize(): Promise<void>;
  close(): Promise<void>;
  
  // Policy Pack Methods
  getPolicyPacks(): Promise<PolicyPack[]>;
  getActivePolicyPack(): Promise<PolicyPack | null>;
  setActivePolicyPack(policyPackId: number): Promise<void>;
  
  // Moderation Rules Methods
  getModerationRules(policyPackId: number): Promise<ModerationRule[]>;
  
  // Moderation Logs Methods
  addModerationLog(log: ModerationLog): Promise<number>;
  getModerationLogByMessageId(messageId: string): Promise<ModerationLog | null>;
  
  // Bot Configuration Methods
  getBotConfig(guildId: string): Promise<BotConfig | null>;
  updateBotConfig(config: BotConfig): Promise<void>;
  
  // Message Context Methods (for RAG)
  addMessageContext(channelId: string, messageId: string, userId: string, content: string, timestamp: Date): Promise<void>;
  getRecentMessageContext(channelId: string, limit?: number): Promise<Array<{user_id: string, content: string, timestamp: string}>>;
  
  // Banned Words Methods
  getBannedWords(policyPackId: number): Promise<Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}>>;
  
  // Blocked URLs Methods
  getBlockedUrls(policyPackId: number): Promise<Array<{url_pattern: string, is_regex: boolean, reason: string, action: string}>>;
}