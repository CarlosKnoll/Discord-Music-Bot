import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import {
  updatePool,
  getPoolSize,
  setAmbientEnabled,
  isAmbientEnabled,
} from '../music/JukeboxManager';

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
      const total = getPoolSize(guildId);
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
  }
};