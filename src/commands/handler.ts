import { ChatInputCommandInteraction } from 'discord.js';
import { playCommand } from './play';
import { skipCommand } from './skip';
import { stopCommand } from './stop';
import { queueCommand } from './queue';
import { pauseCommand } from './pause';
import { resumeCommand } from './resume';
import { volumeCommand } from './volume';
import { playlistCommand } from './playlist';

export const commands: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  play: playCommand.execute.bind(playCommand),
  skip: skipCommand.execute.bind(skipCommand),
  stop: stopCommand.execute.bind(stopCommand),
  queue: queueCommand.execute.bind(queueCommand),
  pause: pauseCommand.execute.bind(pauseCommand),
  resume: resumeCommand.execute.bind(resumeCommand),
  volume: volumeCommand.execute.bind(volumeCommand),
  playlist: playlistCommand.execute.bind(playlistCommand),

};

export async function handleCommand(interaction: ChatInputCommandInteraction) {
  const handler = commands[interaction.commandName];

  if (!handler) {
    await interaction.reply({ content: 'Comando desconhecido.', ephemeral: true });
    return;
  }

  try {
    await handler(interaction);
  } catch (err) {
    console.error(`Error handling /${interaction.commandName}:`, err);
    const msg = { content: '❌ Algo deu errado.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}