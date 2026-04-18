import ytdlp from 'yt-dlp-exec';

export interface TrackInfo {
  title: string;
  url: string;
  streamUrl: string;
  duration: number;
  thumbnail: string;
  requestedBy: string;
  prefetched?: boolean;
  origin?: 'user' | 'jukebox';  // ← add this
}

// Resolves a YouTube URL or search query into a TrackInfo object
export async function resolve(input: string, requestedBy: string): Promise<TrackInfo> {
  const isUrl = input.startsWith('http://') || input.startsWith('https://');
  const cleaned = isUrl ? stripPlaylist(input) : input;
  const query = isUrl ? cleaned : `ytsearch1:${input}`;

  // Reject if yt-dlp takes longer than 15 seconds
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('yt-dlp timed out after 15 seconds')), 15_000)
  );

  const info = await Promise.race([
    ytdlp(query, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      format: 'bestaudio/best',
      addHeader: 'referer:youtube.com',
      jsRuntimes: 'node',
      remoteComponents: 'ejs:github',
    } as any),
    timeout,
  ]) as any;

  const data = info.entries ? info.entries[0] : info;

  if (!data) {
    throw new Error(`No results found for: ${input}`);
  }

  const streamUrl = extractStreamUrl(data);

  return {
    title: data.title,
    url: data.webpage_url ?? data.url,
    streamUrl,
    duration: data.duration ?? 0,
    thumbnail: data.thumbnail ?? '',
    requestedBy,
    prefetched: false,
  };
}

// Picks the best audio-only stream URL from yt-dlp's format list
function extractStreamUrl(data: any): string {
  // If yt-dlp already resolved a single best URL, use it
  if (data.url && !data.formats) {
    return data.url;
  }

  // Otherwise pick the best audio-only format manually
  const formats: any[] = data.formats ?? [];

  const audioOnly = formats
    .filter(f => f.acodec !== 'none' && f.vcodec === 'none')
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));  // sort by bitrate descending

  if (audioOnly.length > 0) {
    return audioOnly[0].url;
  }

  // Fallback: just use whatever yt-dlp picked as best
  return data.url;
}

// Formats seconds into mm:ss or hh:mm:ss for display
export function formatDuration(seconds: number): string {
  if (!seconds) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Strips &list= and &index= params so a shared playlist URL plays just the video
export function stripPlaylist(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('list');
    u.searchParams.delete('index');
    return u.toString();
  } catch {
    return url; // not a valid URL, return as-is
  }
}

// Resolves all entries in a playlist. Returns basic TrackInfo for each
// (no stream URL yet — the existing prefetch system handles that).
export async function resolvePlaylist(
  url: string,
  requestedBy: string
): Promise<TrackInfo[]> {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    flatPlaylist: true,       // metadata only, no stream URL resolution per entry
    format: 'bestaudio/best',
    jsRuntimes: 'node',
    remoteComponents: 'ejs:github',
  } as any) as any;

  if (!info.entries || info.entries.length === 0) {
    throw new Error('No entries found in playlist.');
  }

  return info.entries.map((entry: any) => ({
    title: entry.title ?? 'Unknown',
    url: `https://www.youtube.com/watch?v=${entry.id}`,
    streamUrl: '',       // empty — will be resolved by prefetch or playNext
    duration: entry.duration ?? 0,
    thumbnail: entry.thumbnail ?? entry.thumbnails?.[0]?.url ?? '',
    requestedBy,
    prefetched: false,
  }));
}