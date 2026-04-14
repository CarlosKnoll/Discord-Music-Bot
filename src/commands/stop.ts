import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { leaveChannel } from '../music/MusicManager';

export const stopCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Pare a reprodução, limpe a fila e saia do canal'),

  async execute(interaction: ChatInputCommandInteraction) {
    const left = leaveChannel(interaction.guildId!);

    if (!left) {
      await interaction.reply({ content: '❌ Nada está sendo reproduzido.', ephemeral: true });
      return;
    }

    await interaction.reply('⏹️ Parado e fila limpa.');
  }
};