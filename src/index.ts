import { Client, GatewayIntentBits, Interaction } from 'discord.js';
import * as dotenv from 'dotenv';
import { handleCommand } from './commands/handler';
import { getState, leaveChannel } from './music/MusicManager';

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

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = oldState.guild.id;
  const state = getState(guildId);
  if (!state) return;

  // Get the channel the bot is currently in
  const botChannel = oldState.guild.members.me?.voice.channel;
  if (!botChannel) return;

  // If only the bot remains, leave
  const humanMembers = botChannel.members.filter(m => !m.user.bot);
  if (humanMembers.size === 0) {
    console.log(`[Voice] Everyone left in guild ${guildId}, auto-leaving.`);
    leaveChannel(guildId);
  }
});

client.login(process.env.DISCORD_TOKEN);