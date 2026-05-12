import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Guild, VoiceBasedChannel } from 'discord.js';
import { joinChannel, enqueue, setMode, leaveChannel } from './MusicManager';
import { resolve, TrackInfo } from './YtdlpExtractor';

dotenv.config();

// ─── Per-guild state ──────────────────────────────────────────────────────────

interface JukeboxGuildState {
  pool: string[];           // Remaining (unconsumed) URLs, in shuffled order
  consumed: Set<string>;
  ambientEnabled: boolean;
  playlistActive: boolean;
}

const guildStates = new Map<string, JukeboxGuildState>();

function getOrCreate(guildId: string): JukeboxGuildState {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      pool: [],
      consumed: new Set(),
      ambientEnabled: true,
      playlistActive: false,
    });
  }
  return guildStates.get(guildId)!;
}

// ─── Google Sheets auth ───────────────────────────────────────────────────────
// Read/write scope covers both the public collaborative sheet and the private
// state sheet with the same credentials.

function getAuth() {
  const keyFile = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// ─── Public sheet: fetch collaborative URL pool ───────────────────────────────

async function fetchFromSheet(): Promise<string[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: 'A:A',
  });

  return (res.data.values ?? [])
    .flat()
    .map(v => String(v).trim())
    .filter(v => v.startsWith('http'));
}

// ─── Private state sheet: persist shuffle across reboots ─────────────────────
//
// Layout of the state sheet (one tab named after the guildId):
//   Column A: URL
//   Column B: "consumed" | "pending"
//
// This sheet is never shared with users — only the service account has access.
// The shuffle order written here is what makes persistence work: we write the
// entire randomised sequence once, then drain it entry by entry.

async function readState(guildId: string): Promise<{ pool: string[]; consumed: Set<string> } | null> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  // Ensure the tab for this guild exists; if not, there's no saved state yet.
  let sheetMeta;
  try {
    sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_STATE_SHEET_ID!,
    });
  } catch (err) {
    console.warn(`[JukeboxState:${guildId}] Could not access state sheet:`, err);
    return null;
  }

  const tabExists = sheetMeta.data.sheets?.some(
    s => s.properties?.title === guildId
  );
  if (!tabExists) return null;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_STATE_SHEET_ID!,
    range: `${guildId}!A:B`,
  });

  const rows = res.data.values ?? [];
  if (rows.length === 0) return null;

  const pool: string[] = [];
  const consumed = new Set<string>();

  for (const [url, status] of rows) {
    if (!url || !url.startsWith('http')) continue;
    if (status === 'consumed') {
      consumed.add(url);
    } else {
      pool.push(url); // Preserves the persisted shuffle order
    }
  }

  console.log(
    `[JukeboxState:${guildId}] Resumed from state sheet — ` +
    `${pool.length} pending, ${consumed.size} consumed.`
  );

  return { pool, consumed };
}

async function writeState(guildId: string, pool: string[], consumed: Set<string>): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const spreadsheetId = process.env.GOOGLE_STATE_SHEET_ID!;

  // Ensure the guild's tab exists, creating it if needed.
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabExists = sheetMeta.data.sheets?.some(
    s => s.properties?.title === guildId
  );

  if (!tabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: guildId } } }],
      },
    });
  }

  // Write the full state: consumed entries first (for easy reading), then
  // pending entries in their shuffled order. The order of pending rows IS
  // the shuffle — this is what we restore on reboot.
  const consumedRows = [...consumed].map(url => [url, 'consumed']);
  const pendingRows  = pool.map(url => [url, 'pending']);
  const allRows = [...consumedRows, ...pendingRows];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${guildId}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  // Clear any leftover rows below the new data (e.g. from a previously larger pool).
  const totalRows = allRows.length;
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${guildId}!A${totalRows + 1}:B`,
  });
}

// Clears the guild's tab entirely — called when the pool is fully depleted
// and we're about to generate a fresh shuffle.
async function clearState(guildId: string): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_STATE_SHEET_ID!,
      range: `${guildId}!A:B`,
    });
  } catch {
    // Tab may not exist yet — that's fine.
  }
}

// ─── Fisher-Yates shuffle ─────────────────────────────────────────────────────
// Statistically unbiased, unlike .sort(() => Math.random() - 0.5).

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * On startup: try to resume from the private state sheet.
 * Only generates a new shuffle if no valid state exists.
 */
export async function loadPool(guildId: string): Promise<number> {
  const state = getOrCreate(guildId);

  const saved = await readState(guildId);

  if (saved && saved.pool.length > 0) {
    // Resume the persisted shuffle — no new randomisation needed.
    state.pool = saved.pool;
    state.consumed = saved.consumed;
    console.log(`[Jukebox:${guildId}] Pool resumed: ${state.pool.length} URLs remaining.`);
    return state.pool.length;
  }

  // No valid state — fetch fresh and generate a new shuffle.
  const fresh = await fetchFromSheet();
  shuffleInPlace(fresh);
  state.pool = fresh;
  state.consumed.clear();

  // Persist the new shuffle immediately so a crash right after startup
  // doesn't lose the order.
  writeState(guildId, state.pool, state.consumed).catch(err =>
    console.warn(`[JukeboxState:${guildId}] Initial state write failed:`, err)
  );

  console.log(`[Jukebox:${guildId}] Pool loaded fresh: ${state.pool.length} URLs.`);
  return state.pool.length;
}

/**
 * Merges new URLs from the sheet into the active pool without disrupting
 * the current shuffle order. New entries are appended after existing ones
 * (not interleaved), then state is persisted.
 */
export async function updatePool(guildId: string): Promise<number> {
  const state = getOrCreate(guildId);
  const fresh = await fetchFromSheet();
  const existing = new Set([...state.pool, ...state.consumed]);
  const newEntries = fresh.filter(u => !existing.has(u));

  // Shuffle just the new batch before appending so they're not in
  // sheet-insertion order relative to each other.
  shuffleInPlace(newEntries);
  state.pool.push(...newEntries);

  writeState(guildId, state.pool, state.consumed).catch(err =>
    console.warn(`[JukeboxState:${guildId}] State write after update failed:`, err)
  );

  console.log(`[Jukebox:${guildId}] Pool updated: +${newEntries.length} new URLs. Pool: ${state.pool.length}`);
  return newEntries.length;
}

/**
 * Clears persisted state and generates a completely fresh shuffle.
 * Called when the pool is exhausted and ambient mode keeps going.
 */
export async function silentReload(guildId: string): Promise<void> {
  const state = getOrCreate(guildId);
  const fresh = await fetchFromSheet();
  shuffleInPlace(fresh);
  state.consumed.clear();
  state.pool = fresh;

  await clearState(guildId);
  writeState(guildId, state.pool, state.consumed).catch(err =>
    console.warn(`[JukeboxState:${guildId}] State write after silent reload failed:`, err)
  );

  console.log(`[Jukebox:${guildId}] Silent reload: ${state.pool.length} URLs available.`);
}

/**
 * Pops the next URL from the front of the shuffled pool (not random — the
 * randomness was baked in at shuffle time). Persists the consumed state.
 */
export function pickRandom(guildId: string): string | null {
  const state = getOrCreate(guildId);
  if (state.pool.length === 0) return null;

  // Take from the front — the shuffle order was fixed at load/reload time.
  const url = state.pool.shift()!;
  state.consumed.add(url);

  // Persist asynchronously — don't block playback on a Sheets write.
  writeState(guildId, state.pool, state.consumed).catch(err =>
    console.warn(`[JukeboxState:${guildId}] State write after pick failed:`, err)
  );

  // Pool just emptied — reload so ambient keeps working next trigger.
  if (state.pool.length === 0) {
    console.log(`[Jukebox:${guildId}] Pool exhausted by ambient, scheduling reload.`);
    silentReload(guildId).catch(err =>
      console.warn(`[Jukebox:${guildId}] Silent reload failed:`, err)
    );
  }

  return url;
}

/**
 * Returns all remaining pool entries in order (for /jukebox playlist).
 * The order was already shuffled — drain it as-is.
 */
export function drainPool(guildId: string): string[] {
  const state = getOrCreate(guildId);
  const drained = [...state.pool];
  drained.forEach(u => state.consumed.add(u));
  state.pool = [];

  writeState(guildId, state.pool, state.consumed).catch(err =>
    console.warn(`[JukeboxState:${guildId}] State write after drain failed:`, err)
  );

  return drained;
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
  if (getPoolSize(guild.id) === 0) {
    console.log(`[Jukebox:${guild.id}] Pool empty on ambient trigger, attempting reload.`);
    try {
      await loadPool(guild.id);
    } catch (err) {
      console.error(`[Jukebox:${guild.id}] Pool reload failed on ambient trigger:`, err);
      return;
    }
  }

  const url = pickRandom(guild.id);

  if (!url) {
    console.log(`[Jukebox:${guild.id}] Ambient triggered but pool is empty.`);
    return;
  }

  try {
    await joinChannel(guild, channel);
    const track = await resolve(url, 'Jukebox');
    setMode(guild.id, 'jukebox');
    await enqueue(guild.id, track, 'jukebox');
    console.log(`[Jukebox:${guild.id}] Ambient playing: ${track.title}`);
  } catch (err) {
    console.error(`[Jukebox:${guild.id}] Ambient trigger failed:`, err);
    leaveChannel(guild.id);
    // Return the URL to the front of the pool so it gets another chance.
    const state = getOrCreate(guild.id);
    state.consumed.delete(url);
    state.pool.unshift(url);
    writeState(guild.id, state.pool, state.consumed).catch(() => {});
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