import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { setVolume } from '../music/MusicManager';

export const volumeCommand = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Ajustar o volume da reprodução (0–100)')
    .addIntegerOption(opt =>
      opt
        .setName('level')
        .setDescription('Nível do volume (0–100)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const level = interaction.options.getInteger('level', true);
    const normalized = level / 100;

    const ok = setVolume(interaction.guildId!, normalized);

    if (!ok) {
      await interaction.reply({ content: '❌ O bot não está em um canal de voz.', ephemeral: true });
      return;
    }

    await interaction.reply(`🔊 Volume ajustado para **${level}%**.`);
  }
};