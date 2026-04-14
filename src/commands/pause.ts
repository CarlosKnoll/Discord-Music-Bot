import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { pause } from '../music/MusicManager';

export const pauseCommand = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa a música que está tocando atualmente'),

  async execute(interaction: ChatInputCommandInteraction) {
    const paused = pause(interaction.guildId!);

    if (!paused) {
      await interaction.reply({ content: '❌ Nada está sendo reproduzido.', ephemeral: true });
      return;
    }

    await interaction.reply('⏸️ Pausado.');
  }
};