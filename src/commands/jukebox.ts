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
    .setDescription('Jukebox controls')
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable ambient mode — bot auto-joins when users enter a voice channel')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable ambient mode')
    )
    .addSubcommand(sub =>
      sub
        .setName('update')
        .setDescription('Merge new URLs from the Google Sheet into the active pool')
    )
    .addSubcommand(sub =>
      sub
        .setName('playlist')
        .setDescription('Queue the entire URL pool in random order')
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Stop jukebox, clear jukebox queue, hand control back to user queue or idle')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;  // ← add this once at the top

    if (sub === 'enable') {
      await interaction.deferReply();
      if (isAmbientEnabled(guildId)) {
        await interaction.editReply('Ambient mode is already enabled.');
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
        `✅ Ambient mode enabled. Pool has **${total}** track${total !== 1 ? 's' : ''} available.`
      );
      return;
    }

    if (sub === 'disable') {
      await interaction.deferReply();
      if (!isAmbientEnabled(guildId)) {
        await interaction.editReply('Ambient mode is already disabled.');
        return;
      }

      setAmbientEnabled(guildId, false);
      // Do NOT touch jukeboxQueue or playlistActive — playlist runs independently

      await interaction.editReply('⏹️ Ambient mode disabled.');
      return;
    }

    if (sub === 'update') {
      await interaction.deferReply();
      try {
        const added = await updatePool(guildId);
        const total = getPoolSize(guildId);
        if (added === 0) {
          await interaction.editReply('No new URLs found in the sheet.');
          return;
        }
        await interaction.editReply(
          `✅ Added **${added}** new URL${added !== 1 ? 's' : ''} to the pool. ` +
          `Pool now has **${total}** track${total !== 1 ? 's' : ''}.`
        );
      } catch (err) {
        console.error('[Jukebox] Update failed:', err);
        await interaction.editReply('❌ Failed to fetch from Google Sheet. Check console for details.');
      }
      return;
    }

    if (sub === 'playlist') {
      await interaction.deferReply();

      const member = interaction.member as GuildMember;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        await interaction.editReply('❌ You need to be in a voice channel first.');
        return;
      }

      if (isPlaylistActive(guildId)) {
        await interaction.editReply('❌ Jukebox playlist is already running.');
        return;
      }

      await loadPool(guildId);

      const poolSize = getPoolSize(guildId);
      if (poolSize === 0) {
        await interaction.editReply(
          '❌ No URLs found in the sheet.'
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
        `🎲 Jukebox playlist started — **${urls.length} tracks** queued.\n` +
        `${status === 'playing' ? '▶️ Now playing' : '➕ Up next'}: **${first.title}** ` +
        `(${formatDuration(first.duration)})\n` +
        `Queueing the rest in the background…`
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
        content: `✅ All **${urls.length - 1}** remaining tracks queued.`,
        ephemeral: false,
      });

      return;
    }

    if (sub === 'stop') {
      await interaction.deferReply();

      const state = getState(guildId);
      if (!state) {
        await interaction.editReply('❌ Bot is not active.');
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
          `⏹️ Jukebox stopped. **${lengths.user}** requested track${lengths.user !== 1 ? 's' : ''} will continue.`
        );
      } else {
        await interaction.editReply('⏹️ Jukebox stopped. Bot will go idle.');
      }
      return;
    }
  }
};