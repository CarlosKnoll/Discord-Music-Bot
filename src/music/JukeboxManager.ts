import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Guild, VoiceBasedChannel } from 'discord.js';
import { joinChannel, enqueue, setMode } from './MusicManager';
import { resolve, TrackInfo } from './YtdlpExtractor';

dotenv.config();

// ─── Per-guild state ──────────────────────────────────────────────────────────

interface JukeboxGuildState {
  pool: string[];
  consumed: Set<string>;
  ambientEnabled: boolean;
  playlistActive: boolean;  // ← new
}

const guildStates = new Map<string, JukeboxGuildState>();

function getOrCreate(guildId: string): JukeboxGuildState {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      pool: [],
      consumed: new Set(),
      ambientEnabled: false,
      playlistActive: false,  // ← new
    });
  }
  return guildStates.get(guildId)!;
}

// ─── Internal: Google Sheets fetch ───────────────────────────────────────────

async function fetchFromSheet(): Promise<string[]> {
  const keyFile = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: 'A:A',
  });

  return (res.data.values ?? [])
    .flat()
    .map(v => String(v).trim())
    .filter(v => v.startsWith('http'));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadPool(guildId: string): Promise<number> {
  const state = getOrCreate(guildId);
  const fresh = await fetchFromSheet();
  state.pool = fresh;
  state.consumed.clear();
  console.log(`[Jukebox:${guildId}] Pool loaded: ${state.pool.length} URLs.`);
  return state.pool.length;
}

export async function updatePool(guildId: string): Promise<number> {
  const state = getOrCreate(guildId);
  const fresh = await fetchFromSheet();
  const existing = new Set(state.pool);
  const newEntries = fresh.filter(u => !existing.has(u) && !state.consumed.has(u));
  state.pool.push(...newEntries);
  console.log(`[Jukebox:${guildId}] Pool updated: +${newEntries.length} new URLs. Pool: ${state.pool.length}`);
  return newEntries.length;
}

export async function silentReload(guildId: string): Promise<void> {
  const state = getOrCreate(guildId);
  const fresh = await fetchFromSheet();
  // Clear consumed so ambient has a full pool again
  state.consumed.clear();
  state.pool = fresh;
  console.log(`[Jukebox:${guildId}] Silent reload: ${state.pool.length} URLs available for ambient.`);
}

export function pickRandom(guildId: string): string | null {
  const state = getOrCreate(guildId);
  if (state.pool.length === 0) return null;

  const index = Math.floor(Math.random() * state.pool.length);
  const [url] = state.pool.splice(index, 1);
  state.consumed.add(url);

  // Pool just emptied — silently reload so ambient keeps working
  if (state.pool.length === 0) {
    console.log(`[Jukebox:${guildId}] Pool exhausted by ambient, scheduling reload.`);
    silentReload(guildId).catch(err =>
      console.warn(`[Jukebox:${guildId}] Silent reload failed:`, err)
    );
  }

  return url;
}

export function drainPool(guildId: string): string[] {
  const state = getOrCreate(guildId);
  const shuffled = [...state.pool].sort(() => Math.random() - 0.5);
  state.pool = [];
  shuffled.forEach(u => state.consumed.add(u));
  return shuffled;
}

export function setAmbientEnabled(guildId: string, value: boolean): void {
  const state = getOrCreate(guildId);
  state.ambientEnabled = value;
  console.log(`[Jukebox:${guildId}] Ambient mode ${value ? 'enabled' : 'disabled'}.`);
}

export function isAmbientEnabled(guildId: string): boolean {
  return getOrCreate(guildId).ambientEnabled;
}

export function getPoolSize(guildId: string): number {
  return getOrCreate(guildId).pool.length;
}

export function getConsumedCount(guildId: string): number {
  return getOrCreate(guildId).consumed.size;
}

export async function triggerAmbient(
  guild: Guild,
  channel: VoiceBasedChannel
): Promise<void> {
  const url = pickRandom(guild.id);

  if (!url) {
    console.log(`[Jukebox:${guild.id}] Ambient triggered but pool is empty.`);
    return;
  }

  try {
    await joinChannel(guild, channel);
    const track = await resolve(url, 'Jukebox');
    setMode(guild.id, 'jukebox');
    await enqueue(guild.id, track, 'jukebox');  // ← pass origin
    console.log(`[Jukebox:${guild.id}] Ambient playing: ${track.title}`);
  } catch (err) {
    console.error(`[Jukebox:${guild.id}] Ambient trigger failed:`, err);
  }
}

export function isPlaylistActive(guildId: string): boolean {
  return getOrCreate(guildId).playlistActive;
}

export function setPlaylistActive(guildId: string, value: boolean): void {
  getOrCreate(guildId).playlistActive = value;
}

export async function enrichQueue(queue: TrackInfo[]): Promise<void> {
  const BATCH_SIZE = 3;

  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (track) => {
        if (!track.title.startsWith('Track ')) return;
        try {
          const fresh = await resolve(track.url, track.requestedBy);
          track.title = fresh.title;
          track.duration = fresh.duration;
          track.thumbnail = fresh.thumbnail;
          track.streamUrl = fresh.streamUrl;
          track.prefetched = true;
        } catch (err) {
          console.warn(`[Jukebox] Failed to enrich ${track.url}: ${err}`);
        }
      })
    );
  }
}