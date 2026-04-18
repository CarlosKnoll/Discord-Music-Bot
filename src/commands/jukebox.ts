import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import {
  updatePool,
  getPoolSize,
  setAmbientEnabled,
  isAmbientEnabled,
  drainPool,
  loadPool,
  isPlaylistActive,
  setPlaylistActive,
} from '../music/JukeboxManager';
import { joinChannel, enqueue, getState, stop, clearJukeboxQueue, getQueueLengths } from '../music/MusicManager';
import { resolve, formatDuration } from '../music/YtdlpExtractor';
import { GuildMember } from 'discord.js';

export const jukeboxCommand = {
  data: new SlashCommandBuilder()
    .setName('jukebox')
    .setDescription('Controles da Jukebox')
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Habilitar modo ambiente — o bot entra automaticamente quando os usuários entrarem em um canal de voz')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Desabilitar modo ambiente')
    )
    .addSubcommand(sub =>
      sub
        .setName('update')
        .setDescription('Juntar novas URLs da planilha do Google na pool ativa')
    )
    .addSubcommand(sub =>
      sub
        .setName('playlist')
        .setDescription('Enfileira todo o pool de URLs em ordem aleatória')
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Para a jukebox e devolve o controle para a fila do usuário.')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;  // ← add this once at the top

    if (sub === 'enable') {
      await interaction.deferReply();
      if (isAmbientEnabled(guildId)) {
        await interaction.editReply('❌ Modo ambiente já está ativado.');
        return;
      }
      setAmbientEnabled(guildId, true);

      // If pool is empty when enabling, reload from sheet
      let total = getPoolSize(guildId);
      if (total === 0) {
        try {
          total = await loadPool(guildId);
        } catch (err) {
          console.warn(`[Jukebox:${guildId}] Pool reload on enable failed:`, err);
        }
      }

      await interaction.editReply(
        `✅ Modo ambiente ativado. Pool tem **${total}** faixa${total !== 1 ? 's' : ''} disponível.`
      );
      return;
    }

    if (sub === 'disable') {
      await interaction.deferReply();
      if (!isAmbientEnabled(guildId)) {
        await interaction.editReply('❌ Modo ambiente já está desativado.');
        return;
      }

      setAmbientEnabled(guildId, false);
      // Do NOT touch jukeboxQueue or playlistActive — playlist runs independently

      await interaction.editReply('⏹️ Modo ambiente desativado.');
      return;
    }

    if (sub === 'update') {
      await interaction.deferReply();
      try {
        const added = await updatePool(guildId);
        const total = getPoolSize(guildId);
        if (added === 0) {
          await interaction.editReply('❌ Nenhuma nova URL encontrada na planilha.');
          return;
        }
        await interaction.editReply(
          `✅ Adicionadas **${added}** novas URLs ao pool. ` +
          `Pool agora tem **${total}** faixa${total !== 1 ? 's' : ''}.`
        );
      } catch (err) {
        console.error('[Jukebox] Update failed:', err);
        await interaction.editReply('❌ Falha ao buscar na planilha do Google. Verifique os logs para detalhes.');
      }
      return;
    }

    if (sub === 'playlist') {
      await interaction.deferReply();

      const member = interaction.member as GuildMember;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        await interaction.editReply('❌ Você precisa estar em um canal de voz primeiro.');
        return;
      }

      if (isPlaylistActive(guildId)) {
        await interaction.editReply('❌ Jukebox já está rodando.');
        return;
      }

      await loadPool(guildId);

      const poolSize = getPoolSize(guildId);
      if (poolSize === 0) {
        await interaction.editReply(
          '❌ Nenhuma URL encontrada na planilha.'
        );
        return;
      }

      await joinChannel(interaction.guild!, voiceChannel);

      // Capture currently playing jukebox track URL before reload
      const state = getState(guildId);
      const currentUrl = state?.currentTrack?.origin === 'jukebox'
        ? state.currentTrack.url
        : null;

      await loadPool(guildId);

      // Drain pool, excluding currently playing track to avoid duplication
      const urls = drainPool(guildId).filter(u => u !== currentUrl);
      setPlaylistActive(guildId, true);

      // Resolve and play the first track immediately
      const first = await resolve(urls[0], 'Jukebox');
      first.origin = 'jukebox';
      const status = await enqueue(guildId, first, 'jukebox');

      await interaction.editReply(
        `🎲 Playlist da jukebox iniciada — **${urls.length} faixas** enfileiradas.\n` +
        `${status === 'playing' ? '▶️ Tocando' : '➕ Próxima'}: **${first.title}** ` +
        `(${formatDuration(first.duration)})\n` +
        `Enfileirando o restante em segundo plano…`
      );

      // Push remaining tracks directly into jukeboxQueue without resolving stream URLs
      // ensureStreamUrl + prefetchNext handle lazy resolution as each track plays
      if (state) {
        // Push remaining tracks as placeholders
        for (let i = 1; i < urls.length; i++) {
          state.jukeboxQueue.push({
            title: `Track ${i + 1}`,
            url: urls[i],
            streamUrl: '',
            duration: 0,
            thumbnail: '',
            requestedBy: 'Jukebox',
            origin: 'jukebox',
            prefetched: false,
          });
        }

        // Enrich titles in background — patches queue entries in place
        import('../music/JukeboxManager').then(({ enrichQueue }) => {
          enrichQueue(state.jukeboxQueue).catch(err =>
            console.warn('[Jukebox] Enrichment failed:', err)
          );
        });
      }

      await interaction.followUp({
        content: `✅ Todas as **${urls.length - 1}** faixas restantes foram enfileiradas.`,
        ephemeral: false,
      });

      return;
    }

    if (sub === 'stop') {
      await interaction.deferReply();

      const state = getState(guildId);
      if (!state) {
        await interaction.editReply('❌ Bot não está ativo.');
        return;
      }

      clearJukeboxQueue(guildId);
      setPlaylistActive(guildId, false);

      const lengths = getQueueLengths(guildId);

      // Only stop current track if it's jukebox-originated
      // If a user track is playing, let it finish — userQueue continues naturally
      if (state.currentTrack?.origin === 'jukebox') {
        state.player.stop(); // triggers Idle → playNext → picks from userQueue if any
      }

      if (lengths.user > 0) {
        await interaction.editReply(
          `⏹️ Jukebox interrompida. **${lengths.user}** faixas requiridas${lengths.user !== 1 ? 's' : ''} irão continuar.`
        );
      } else {
        await interaction.editReply('⏹️ Jukebox interrompida. Bot ficará ocioso.');
      }
      return;
    }
  }
};