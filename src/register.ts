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

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    console.log('Registering slash commands...');
    // Dev version: Guild-specific so changes are instant, but only works in the GUILD_ID server.
    // await rest.put(
    //   Routes.applicationGuildCommands(
    //     process.env.CLIENT_ID!,
    //     process.env.GUILD_ID!
    //   ),
    //   { body: commands }
    // );
    // Final version: Global registers so it can work in multiple servers.
    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID!),
        { body: commands }
    );
    console.log('✅ Commands registered.');
  } catch (err) {
    console.error(err);
  }
})();