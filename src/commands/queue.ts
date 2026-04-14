import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getState } from '../music/MusicManager';
import { formatDuration } from '../music/YtdlpExtractor';

export const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Mostra a fila atual'),

  async execute(interaction: ChatInputCommandInteraction) {
    const state = getState(interaction.guildId!);

    if (!state || !state.currentTrack) {
      await interaction.reply({ content: '❌ Nada está sendo reproduzido.', ephemeral: true });
      return;
    }

    const lines: string[] = [
      `▶️ **Tocando:** ${state.currentTrack.title} (${formatDuration(state.currentTrack.duration)}) — ${state.currentTrack.requestedBy}`,
    ];

    if (state.queue.length === 0) {
      lines.push('\n*Nenhuma música na fila.*');
    } else {
      lines.push('\n**Próximas:**');
      state.queue.slice(0, 10).forEach((track, i) => {
        lines.push(`${i + 1}. ${track.title} (${formatDuration(track.duration)}) — ${track.requestedBy}`);
      });

      if (state.queue.length > 10) {
        lines.push(`\n*...e ${state.queue.length - 10} mais.*`);
      }
    }

    await interaction.reply(lines.join('\n'));
  }
};