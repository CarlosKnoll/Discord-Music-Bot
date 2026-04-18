import {
  VoiceConnection,
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  AudioPlayer,
  AudioPlayerStatus,
} from '@discordjs/voice';
import { Guild, VoiceBasedChannel } from 'discord.js';
import { createStream } from './AudioStream';
import { TrackInfo, resolve  } from './YtdlpExtractor';

type BotMode = 'idle' | 'jukebox' | 'queue';

interface GuildMusicState {
  connection: VoiceConnection;
  player: AudioPlayer;
  channelId: string;
  volume: number;
  currentTrack: TrackInfo | null;
  queue: TrackInfo[];
  currentFfmpeg: ReturnType<typeof import('child_process').spawn> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  mode: BotMode;
}

interface GuildMusicState {
  connection: VoiceConnection;
  player: AudioPlayer;
  channelId: string;
  volume: number;
  currentTrack: TrackInfo | null;
  queue: TrackInfo[];
  currentFfmpeg: ReturnType<typeof import('child_process').spawn> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const guildStates = new Map<string, GuildMusicState>();

const IDLE_TIMEOUT_MS = 1000; // 1 second
// ─── Internal: play the next track in queue ───────────────────────────────────

async function playNext(guildId: string): Promise<void> {
  const state = guildStates.get(guildId);
  if (!state) return;

  if (state.currentFfmpeg) {
    state.currentFfmpeg.kill('SIGKILL');
    state.currentFfmpeg = null;
  }

  const next = state.queue.shift();

  if (!next) {
    state.currentTrack = null;
    state.mode = 'idle';
    scheduleIdleLeave(guildId);
    return;
  }

  cancelIdleLeave(guildId);
  const ready = await ensureStreamUrl(next);
  const { resource, ffmpeg } = createStream(ready.streamUrl, state.volume);
  state.currentTrack = ready;
  state.currentFfmpeg = ffmpeg;
  state.player.play(resource);
  prefetchNext(guildId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function joinChannel(
  guild: Guild,
  channel: VoiceBasedChannel
): Promise<void> {
  const existing = getVoiceConnection(guild.id);
  if (existing) return;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    connection.destroy();
    throw new Error('Could not connect to voice channel within 10 seconds.');
  }

  const player = createAudioPlayer();
  connection.subscribe(player);

  // Auto-advance: fires every time a track finishes naturally
  player.on(AudioPlayerStatus.Idle, () => {
    playNext(guild.id);
  });

  // Handle unexpected disconnections
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Give Discord 5 seconds to reconnect on its own before we intervene
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Discord is reconnecting — do nothing
    } catch {
      // Reconnection failed — clean up gracefully
      console.warn(`[Voice] Disconnected from guild ${guild.id}, cleaning up.`);
      connection.destroy();
      guildStates.delete(guild.id);
    }
  });

  guildStates.set(guild.id, {
    connection,
    player,
    channelId: channel.id,
    volume: 1.0,
    currentTrack: null,
    queue: [],
    currentFfmpeg: null,
    idleTimer: null,
    mode: 'idle',
  });
}

// Adds a track to the queue. If nothing is playing, starts immediately.
export async function enqueue(guildId: string, track: TrackInfo): Promise<'playing' | 'queued'> {
  const state = guildStates.get(guildId);
  if (!state) throw new Error('Bot is not in a voice channel.');

  cancelIdleLeave(guildId);

  if (state.currentTrack === null && state.queue.length === 0) {
    const ready = await ensureStreamUrl(track);
    const { resource, ffmpeg } = createStream(ready.streamUrl, state.volume);
    state.currentTrack = ready;
    state.currentFfmpeg = ffmpeg;
    state.player.play(resource);
    return 'playing';
  }

  state.queue.push(track);
  return 'queued';
}

// Skips the current track by forcing the player to Idle, triggering auto-advance
export function skip(guildId: string): TrackInfo | null {
  const state = guildStates.get(guildId);
  if (!state || !state.currentTrack) return null;

  const skipped = state.currentTrack;
  state.player.stop(); // triggers the Idle event → playNext()
  return skipped;
}

export function stop(guildId: string): void {
  const state = guildStates.get(guildId);
  if (!state) return;

  cancelIdleLeave(guildId);

  if (state.currentFfmpeg) {
    state.currentFfmpeg.kill('SIGKILL');
    state.currentFfmpeg = null;
  }

  state.queue = [];
  state.currentTrack = null;
  state.player.stop();
}

export function leaveChannel(guildId: string): boolean {
  const connection = getVoiceConnection(guildId);
  if (!connection) return false;

  stop(guildId);
  connection.destroy();
  guildStates.delete(guildId);
  return true;
}

export function getState(guildId: string): GuildMusicState | undefined {
  return guildStates.get(guildId);
}

export function pause(guildId: string): boolean {
  const state = guildStates.get(guildId);
  if (!state || !state.currentTrack) return false;

  return state.player.pause();
}

export function resume(guildId: string): boolean {
  const state = guildStates.get(guildId);
  if (!state || !state.currentTrack) return false;

  return state.player.unpause();
}

// volume: 0.0 to 1.0
export function setVolume(guildId: string, volume: number): boolean {
  const state = guildStates.get(guildId);
  if (!state) return false;

  state.volume = volume;

  // Adjust the currently playing stream in real time if there is one
  const resource = state.player.state.status === AudioPlayerStatus.Playing
    ? (state.player.state as any).resource
    : null;

  if (resource?.volume) {
    resource.volume.setVolume(volume);
  }

  return true;
}

// Fire-and-forget: resolves next track's stream URL while current one plays
function prefetchNext(guildId: string): void {
  const state = guildStates.get(guildId);
  if (!state || state.queue.length === 0) return;

  const next = state.queue[0];
  if (next.prefetched) return; // already done

  // Re-resolve using the original YouTube URL to get a fresh stream URL
  import('./YtdlpExtractor').then(({ resolve }) => {
    resolve(next.url, next.requestedBy)
      .then((fresh) => {
        // Patch the queued track's streamUrl in place
        next.streamUrl = fresh.streamUrl;
        next.prefetched = true;
        console.log(`[Prefetch] Ready: ${next.title}`);
      })
      .catch((err) => {
        console.warn(`[Prefetch] Failed for "${next.title}": ${err.message}`);
        // Not fatal — playNext will try again when it actually plays
      });
  });
}

async function ensureStreamUrl(track: TrackInfo): Promise<TrackInfo> {
  if (track.streamUrl) return track;
  const fresh = await resolve(track.url, track.requestedBy);
  track.streamUrl = fresh.streamUrl;
  track.prefetched = true;
  return track;
}

function scheduleIdleLeave(guildId: string): void {
  const state = guildStates.get(guildId);
  if (!state) return;

  // Clear any existing timer first
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }

  state.idleTimer = setTimeout(() => {
    console.log(`[Idle] No activity for ${IDLE_TIMEOUT_MS / 1000}s in guild ${guildId}, leaving.`);
    leaveChannel(guildId);
  }, IDLE_TIMEOUT_MS);
}

function cancelIdleLeave(guildId: string): void {
  const state = guildStates.get(guildId);
  if (!state?.idleTimer) return;

  clearTimeout(state.idleTimer);
  state.idleTimer = null;
}

export function setMode(guildId: string, mode: BotMode): void {
  const state = guildStates.get(guildId);
  if (!state) return;
  state.mode = mode;
}

export function getMode(guildId: string): BotMode | null {
  const state = guildStates.get(guildId);
  return state?.mode ?? null;
}

// Returns true if the bot is connected and doing something in this guild
export function isActive(guildId: string): boolean {
  const state = guildStates.get(guildId);
  if (!state) return false;
  return state.mode !== 'idle' || state.currentTrack !== null;
}