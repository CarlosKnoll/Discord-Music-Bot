import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Guild, VoiceBasedChannel } from 'discord.js';
import { joinChannel, enqueue, setMode } from './MusicManager';
import { resolve } from './YtdlpExtractor';

dotenv.config();

// ─── Per-guild state ──────────────────────────────────────────────────────────

interface JukeboxGuildState {
  pool: string[];
  consumed: Set<string>;
  ambientEnabled: boolean;
}

const guildStates = new Map<string, JukeboxGuildState>();

function getOrCreate(guildId: string): JukeboxGuildState {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      pool: [],
      consumed: new Set(),
      ambientEnabled: false,
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
  state.pool = fresh.filter(u => !state.consumed.has(u));
  console.log(`[Jukebox:${guildId}] Silent reload: ${state.pool.length} URLs available for ambient.`);
}

export function pickRandom(guildId: string): string | null {
  const state = getOrCreate(guildId);
  if (state.pool.length === 0) return null;

  const index = Math.floor(Math.random() * state.pool.length);
  const [url] = state.pool.splice(index, 1);
  state.consumed.add(url);
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
    await enqueue(guild.id, track);
    console.log(`[Jukebox:${guild.id}] Ambient playing: ${track.title}`);
  } catch (err) {
    console.error(`[Jukebox:${guild.id}] Ambient trigger failed:`, err);
  }
}