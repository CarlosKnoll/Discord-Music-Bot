import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from 'discord.js';
import { joinChannel, enqueue, getState } from '../music/MusicManager';
import { resolvePlaylist, resolve, formatDuration } from '../music/YtdlpExtractor';

export const playlistCommand = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Enfileira uma playlist do YouTube a partir de uma URL')
    .addStringOption(opt =>
      opt
        .setName('url')
        .setDescription('URL da playlist do YouTube')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({ content: '❌ Você precisa estar em um canal de voz primeiro.', ephemeral: true });
      return;
    }

    const url = interaction.options.getString('url', true);

    if (!url.includes('list=')) {
      await interaction.reply({ content: '❌ Essa URL não parece ser de uma playlist.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      await joinChannel(interaction.guild!, voiceChannel);

      const firstVideoUrl = (() => {
        try {
          const u = new URL(url);
          const v = u.searchParams.get('v');
          return v ? `https://www.youtube.com/watch?v=${v}` : url;
        } catch {
          return url;
        }
      })();

      // Kick off full playlist metadata fetch and first-track resolution simultaneously
      const [tracks, first] = await Promise.all([
        resolvePlaylist(url, interaction.user.username),
        // Resolve first track via search on the URL directly — no need to wait for playlist
        resolve(firstVideoUrl, interaction.user.username),
      ]);

      const status = await enqueue(interaction.guildId!, first, 'user');

      await interaction.editReply(
        `📋 Playlist enfileirada: **${tracks.length} músicas**\n` +
        `${status === 'playing' ? '▶️ Tocando' : '➕ Primeira na fila'}: **${first.title}** ` +
        `(${formatDuration(first.duration)})\n` +
        `Enfileirando o restante em segundo plano…`
      );

      // Push remaining tracks directly — prefetch/playNext handles stream URLs lazily
      const state = getState(interaction.guildId!);
      if (state) {
        for (let i = 1; i < tracks.length; i++) {
          tracks[i].origin = 'user';
          state.userQueue.push(tracks[i]);
        }
      }

      await interaction.followUp({
        content: `✅ Concluido — todas as ${tracks.length - 1} músicas restantes enfileiradas.`,
        ephemeral: false,
      });

    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Falha ao carregar a playlist.');
    }
  }
};