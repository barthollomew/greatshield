import { Message } from 'discord.js';
import { BotConfig } from '../../database/DatabaseManager';

export interface ModerationResult {
  action: string;
  reason: string;
  confidence?: number | undefined;
  ruleTriggered?: string | undefined;
  detectionType: 'fast_pass' | 'ai_analysis';
}

export interface IModerationPipeline {
  initialize(config: BotConfig): Promise<void>;
  moderateMessage(message: Message): Promise<ModerationResult | null>;
}