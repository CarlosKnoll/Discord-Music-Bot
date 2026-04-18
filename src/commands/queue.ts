import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getState } from '../music/MusicManager';
import { formatDuration } from '../music/YtdlpExtractor';

export const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Mostra a fila atual.'),

  async execute(interaction: ChatInputCommandInteraction) {
    const state = getState(interaction.guildId!);

    if (!state || !state.currentTrack) {
      await interaction.reply({ content: '❌ Nada está sendo tocado.', ephemeral: true });
      return;
    }

    const origin = state.currentTrack.origin === 'jukebox' ? '🎲 Jukebox' : '👤 Requested';
    const lines: string[] = [
      `▶️ **Tocando agora** [${origin}]: ${state.currentTrack.title} (${formatDuration(state.currentTrack.duration)}) — ${state.currentTrack.requestedBy}`,
    ];

    if (state.userQueue.length > 0) {
      lines.push('\n**Faixas solicitadas:**');
      state.userQueue.slice(0, 10).forEach((track, i) => {
        lines.push(`${i + 1}. ${track.title} (${formatDuration(track.duration)}) — ${track.requestedBy}`);
      });
      if (state.userQueue.length > 10) {
        lines.push(`*...e ${state.userQueue.length - 10} mais.*`);
      }
    }

    if (state.jukeboxQueue.length > 0) {
      lines.push('\n**Fila da Jukebox:**');
      state.jukeboxQueue.slice(0, 5).forEach((track, i) => {
        lines.push(`${i + 1}. ${track.title} (${formatDuration(track.duration)})`);
      });
      if (state.jukeboxQueue.length > 5) {
        lines.push(`*...e ${state.jukeboxQueue.length - 5} mais.*`);
      }
    }

    if (state.userQueue.length === 0 && state.jukeboxQueue.length === 0) {
      lines.push('\n*Sem faixas na fila.*');
    }

    await interaction.reply(lines.join('\n'));
  }
};