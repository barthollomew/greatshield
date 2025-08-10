import { Message } from 'discord.js';
import { ModerationLog } from '../../database/DatabaseManager';

export interface IModerationLogService {
  sendModerationLog(log: ModerationLog, originalMessage: Message): Promise<void>;
}