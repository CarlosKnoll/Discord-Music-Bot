import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getState } from '../music/MusicManager';
import { formatDuration } from '../music/YtdlpExtractor';

export const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue'),

  async execute(interaction: ChatInputCommandInteraction) {
    const state = getState(interaction.guildId!);

    if (!state || !state.currentTrack) {
      await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
      return;
    }

    const origin = state.currentTrack.origin === 'jukebox' ? '🎲 Jukebox' : '👤 Requested';
    const lines: string[] = [
      `▶️ **Now playing** [${origin}]: ${state.currentTrack.title} (${formatDuration(state.currentTrack.duration)}) — ${state.currentTrack.requestedBy}`,
    ];

    if (state.userQueue.length > 0) {
      lines.push('\n**Requested tracks:**');
      state.userQueue.slice(0, 10).forEach((track, i) => {
        lines.push(`${i + 1}. ${track.title} (${formatDuration(track.duration)}) — ${track.requestedBy}`);
      });
      if (state.userQueue.length > 10) {
        lines.push(`*...and ${state.userQueue.length - 10} more.*`);
      }
    }

    if (state.jukeboxQueue.length > 0) {
      lines.push('\n**Jukebox queue:**');
      state.jukeboxQueue.slice(0, 5).forEach((track, i) => {
        lines.push(`${i + 1}. ${track.title} (${formatDuration(track.duration)})`);
      });
      if (state.jukeboxQueue.length > 5) {
        lines.push(`*...and ${state.jukeboxQueue.length - 5} more.*`);
      }
    }

    if (state.userQueue.length === 0 && state.jukeboxQueue.length === 0) {
      lines.push('\n*No tracks queued.*');
    }

    await interaction.reply(lines.join('\n'));
  }
};