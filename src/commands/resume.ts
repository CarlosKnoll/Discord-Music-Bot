import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { resume } from '../music/MusicManager';

export const resumeCommand = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume a música que está pausada atualmente'),

  async execute(interaction: ChatInputCommandInteraction) {
    const resumed = resume(interaction.guildId!);

    if (!resumed) {
      await interaction.reply({ content: '❌ Nada está pausado.', ephemeral: true });
      return;
    }

    await interaction.reply('▶️ Retomado.');
  }
};