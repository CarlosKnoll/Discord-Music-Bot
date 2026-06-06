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
  silentReload,
  isPlaylistActive,
  setPlaylistActive,
  triggerAmbient,
  pickRandom,
} from '../music/JukeboxManager';
import { joinChannel, enqueue, getState, stop, clearJukeboxQueue, getQueueLengths, isActive } from '../music/MusicManager';
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
        .setName('play')
        .setDescription('Aciona a jukebox manualmente para tocar a próxima faixa.')
    )
    .addSubcommand(sub =>
      sub
        .setName('playlist')
        .setDescription('Enfileira as músicas restantes (não tocadas) da pool em ordem aleatória')
    )
    .addSubcommand(sub =>
      sub
        .setName('playlist-full')
        .setDescription('Enfileira TODAS as músicas da planilha (incluindo já tocadas) em nova ordem aleatória')
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
        const { added, injected } = await updatePool(guildId, getState(guildId));
        const total = getPoolSize(guildId);
        if (added === 0) {
          await interaction.editReply('❌ Nenhuma nova URL encontrada na planilha.');
          return;
        }
        let reply =
          `✅ Adicionadas **${added}** novas URLs ao pool. ` +
          `Pool agora tem **${total}** faixa${total !== 1 ? 's' : ''}.`;
        if (injected > 0) {
          reply += `\n➕ **${injected}** faixas também adicionadas diretamente à fila da jukebox (playlist em andamento).`;
        }
        await interaction.editReply(reply);
      } catch (err) {
        console.error('[Jukebox] Update failed:', err);
        await interaction.editReply('❌ Falha ao buscar na planilha do Google. Verifique os logs para detalhes.');
      }
      return;
    }

    if (sub === 'playlist' || sub === 'playlist-full') {
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

      const isFull = sub === 'playlist-full';

      // 'full': discard consumed history and generate a completely fresh shuffle.
      // 'remaining': only reload from sheet/state if the pool is currently empty.
      if (isFull) {
        await silentReload(guildId);
      } else if (getPoolSize(guildId) === 0) {
        await loadPool(guildId);
      }

      const poolSize = getPoolSize(guildId);
      if (poolSize === 0) {
        await interaction.editReply('❌ Nenhuma URL encontrada na planilha.');
        return;
      }

      await joinChannel(interaction.guild!, voiceChannel);

      // Capture currently playing jukebox track to avoid re-queueing it
      const state = getState(guildId);
      const currentUrl = state?.currentTrack?.origin === 'jukebox'
        ? state.currentTrack.url
        : null;

      // Single drain — no second loadPool call that would reset to stale state
      const urls = drainPool(guildId).filter(u => u !== currentUrl);

      if (urls.length === 0) {
        await interaction.editReply('❌ Nenhuma faixa disponível para enfileirar.');
        return;
      }

      setPlaylistActive(guildId, true);

      const modeLabel = isFull ? 'completa' : 'faixas restantes';
      console.log(
        `[Jukebox:${guildId}] Playlist (${modeLabel}) iniciada — ` +
        `${urls.length} faixas para enfileirar.`
      );

      // Resolve and enqueue the first track immediately so playback starts without delay
      console.log(`[Jukebox:${guildId}] [1/${urls.length}] Resolvendo: ${urls[0]}`);
      const first = await resolve(urls[0], 'Jukebox');
      first.origin = 'jukebox';
      const status = await enqueue(guildId, first, 'jukebox');
      console.log(
        `[Jukebox:${guildId}] [1/${urls.length}] ✅ "${first.title}" ` +
        `(${formatDuration(first.duration)}) → ${status}`
      );

      await interaction.editReply(
        `🎲 Playlist da jukebox iniciada (${isFull ? '**completa**' : '**faixas restantes**'}) — **${urls.length} faixas** a tocar.\n` +
        `${status === 'playing' ? '▶️ Tocando' : '➕ Próxima'}: **${first.title}** ` +
        `(${formatDuration(first.duration)})\n` +
        `Enfileirando o restante em segundo plano…`
      );

      // Push remaining tracks as unresolved placeholders — stream URLs are resolved
      // lazily by ensureStreamUrl/prefetchNext as each track is about to play.
      if (state) {
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
          console.log(`[Jukebox:${guildId}] [${i + 1}/${urls.length}] Placeholder: ${urls[i]}`);
        }

        // Enrich titles/durations in background (small batches to avoid yt-dlp overload).
        // guildId and total are threaded through so enrichQueue can log per-track results.
        import('../music/JukeboxManager').then(({ enrichQueue }) => {
          enrichQueue(state.jukeboxQueue, guildId, urls.length).catch(err =>
            console.warn(`[Jukebox:${guildId}] Enriquecimento de fila falhou globalmente:`, err)
          );
        });
      }

      await interaction.followUp({
        content: `✅ **${urls.length - 1}** faixas enfileiradas como placeholders — metadados serão resolvidos conforme tocam.`,
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

    if (sub === 'play') {
      const member = interaction.member as GuildMember;
      const voiceChannel = member.voice?.channel;

      if (!voiceChannel) {
        await interaction.reply({ content: '❌ Você precisa estar em um canal de voz para usar isso.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      if (!isActive(guildId)) {
        // Bot is idle — full ambient path: join, pick, play.
        await triggerAmbient(interaction.guild!, voiceChannel);
        await interaction.editReply('▶️ Tocando a próxima faixa da jukebox.');
      } else {
        // Bot already active — enqueue behind the user queue.
        if (getPoolSize(guildId) === 0) {
          try {
            await loadPool(guildId);
          } catch (err) {
            console.error(`[Jukebox:${guildId}] Pool reload failed on /jukebox play:`, err);
            await interaction.editReply('❌ A pool está vazia e não foi possível recarregar da planilha. Verifique os logs.');
            return;
          }
        }
        const url = pickRandom(guildId);
        if (!url) {
          await interaction.editReply('❌ A pool da jukebox está vazia mesmo após tentativa de recarga.');
          return;
        }
        const track = await resolve(url, 'Jukebox');
        track.origin = 'jukebox';
        await enqueue(guildId, track, 'jukebox');
        const lengths = getQueueLengths(guildId);
        await interaction.editReply(
          lengths.user > 0
            ? `✅ Enfileirada como próxima faixa da jukebox — toca após a fila do usuário (${lengths.user} faixa${lengths.user !== 1 ? 's' : ''}).`
            : `✅ Enfileirada como próxima faixa da jukebox.`
        );
      }
      return;
    }
  }
};