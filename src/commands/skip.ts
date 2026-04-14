import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { skip } from '../music/MusicManager';

export const skipCommand = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Pula a música atual'),

  async execute(interaction: ChatInputCommandInteraction) {
    const skipped = skip(interaction.guildId!);

    if (!skipped) {
      await interaction.reply({ content: '❌ Nada está sendo reproduzido.', ephemeral: true });
      return;
    }

    await interaction.reply(`⏭️ Pulado **${skipped.title}**.`);
  }
};