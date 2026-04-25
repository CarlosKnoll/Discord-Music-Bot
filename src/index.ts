import { Client, GatewayIntentBits, Interaction } from 'discord.js';
import * as dotenv from 'dotenv';
import { handleCommand } from './commands/handler';
import { getState, leaveChannel, isActive } from './music/MusicManager';
import { loadPool, isAmbientEnabled, triggerAmbient } from './music/JukeboxManager';

dotenv.config();

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
  // Don't exit — keep the bot alive
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);

  for (const guild of client.guilds.cache.values()) {
    while (true) {
      try {
        await loadPool(guild.id);
        break;
      } catch (err) {
        console.warn(`[Jukebox] Pool load failed, retrying in 15s...`);
        await new Promise(res => setTimeout(res, 15_000));
      }
    }
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guildId = oldState.guild.id;

  // ── Empty channel auto-leave ──────────────────────────────────────────────
  const state = getState(guildId);
  if (state) {
    const botChannel = oldState.guild.members.me?.voice.channel;
    if (botChannel) {
      const humanMembers = botChannel.members.filter(m => !m.user.bot);
      if (humanMembers.size === 0) {
        console.log(`[Voice] Everyone left in guild ${guildId}, auto-leaving.`);
        leaveChannel(guildId);
        return;
      }
    }
  }

  // ── Ambient join trigger ──────────────────────────────────────────────────
  const memberJoined = !oldState.channel && newState.channel;
  const isHuman = !newState.member?.user.bot;

  if (memberJoined && isHuman && isAmbientEnabled(guildId)) {
    if (isActive(guildId)) {
      console.log(`[Jukebox] Ambient suppressed — bot already active in guild ${guildId}.`);
      return;
    }
    const channel = newState.channel;
    if (channel) {
      console.log(`[Jukebox] Ambient triggered by ${newState.member?.user.username} joining ${channel.name}`);
      await triggerAmbient(newState.guild, channel);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);