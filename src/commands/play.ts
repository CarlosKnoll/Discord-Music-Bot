import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from 'discord.js';
import { joinChannel, enqueue, getState } from '../music/MusicManager';
import { resolve, formatDuration } from '../music/YtdlpExtractor';

export const playCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma música do YouTube a partir de uma URL ou termos de busca')
    .addStringOption(opt =>
      opt
        .setName('query')
        .setDescription('URL do YouTube ou termos de busca')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ Você precisa estar em um canal de voz primeiro.',
        ephemeral: true,
      });
      return;
    }

    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    try {
      await joinChannel(interaction.guild!, voiceChannel);
      const track = await resolve(query, interaction.user.username);
      const status = await enqueue(interaction.guildId!, track, 'user');

      if (status === 'playing') {
        await interaction.editReply(
          `▶️ Now playing: **${track.title}**\n` +
          `Duration: ${formatDuration(track.duration)} | Requested by: ${track.requestedBy}`
        );
      } else {
        const state = getState(interaction.guildId!)!;
        const position = state.userQueue.length;

        // Inform user if it's jumping ahead of jukebox tracks
        const jukeboxNote = state.mode === 'jukebox'
          ? ' *(will play after current jukebox track)*'
          : '';

        await interaction.editReply(
          `➕ Added to queue (#${position}): **${track.title}**\n` +
          `Duration: ${formatDuration(track.duration)} | Requested by: ${track.requestedBy}${jukeboxNote}`
        );
      }
    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Falha ao processar.');
    }
  }
};