import { REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';
import { playCommand } from './commands/play';
import { skipCommand } from './commands/skip';
import { stopCommand } from './commands/stop';
import { queueCommand } from './commands/queue';
import { pauseCommand } from './commands/pause';
import { resumeCommand } from './commands/resume';
import { volumeCommand } from './commands/volume';
import { playlistCommand } from './commands/playlist';
import { jukeboxCommand } from './commands/jukebox';

dotenv.config();

const commands = [
  playCommand.data,
  skipCommand.data,
  stopCommand.data,
  queueCommand.data,
  pauseCommand.data,
  resumeCommand.data,
  volumeCommand.data,
  playlistCommand.data,
  jukeboxCommand.data,
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
const mode = process.argv[2]; // 'guild' | 'global'

(async () => {
  try {
    if (mode === 'global') {
      console.log('Registering commands globally...');
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID!),
        { body: commands }
      );
    } else if (mode === 'cleanup') {
    console.log('Clearing guild commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!),
      { body: [] }
    );
    console.log('✅ Guild commands cleared.');
    } else {
      console.log('Registering commands to guild...');
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!),
        { body: commands }
      );
    }
    console.log('✅ Commands registered.');
  } catch (err) {
    console.error(err);
  }
})();