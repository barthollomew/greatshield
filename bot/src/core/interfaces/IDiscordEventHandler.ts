import { Message, CommandInteraction, Interaction } from 'discord.js';

export interface IDiscordEventHandler {
  handleMessage(message: Message): Promise<void>;
  handleMessageUpdate(oldMessage: Message, newMessage: Message): Promise<void>;
  handleInteraction(interaction: CommandInteraction): Promise<void>;
}