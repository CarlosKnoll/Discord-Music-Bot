import ytdlp from 'yt-dlp-exec';

export interface TrackInfo {
  title: string;
  url: string;
  streamUrl: string;
  streamHeaders?: Record<string, string>;
  duration: number;
  thumbnail: string;
  requestedBy: string;
  prefetched?: boolean;
  origin?: 'user' | 'jukebox';
}

const YTDLP_TIMEOUT_MS = 30_000; // 30 s — enough headroom under heavy host load
const YTDLP_MAX_RETRIES = 2;     // total attempts = 3
const YTDLP_RETRY_DELAY_MS = 2_000;

// Resolves a YouTube URL or search query into a TrackInfo object
export async function resolve(input: string, requestedBy: string): Promise<TrackInfo> {
  const isUrl = input.startsWith('http://') || input.startsWith('https://');
  const cleaned = isUrl ? stripPlaylist(input) : input;
  const query = isUrl ? cleaned : `ytsearch1:${input}`;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= YTDLP_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, YTDLP_RETRY_DELAY_MS));
      console.warn(`[yt-dlp] Retry ${attempt}/${YTDLP_MAX_RETRIES} for: ${input}`);
    }

    try {
      const data = await resolveOnce(query);
      if (!data) throw new Error(`No results found for: ${input}`);

      const { url: streamUrl, headers: streamHeaders} = extractStreamFormat(data);

      return {
        title: data.title,
        url: data.webpage_url ?? data.url,
        streamUrl,
        streamHeaders,
        duration: data.duration ?? 0,
        thumbnail: data.thumbnail ?? '',
        requestedBy,
        prefetched: false,
      };
    } catch (err: any) {
      lastError = err;
      // Only retry on timeout; hard errors (no results, bad URL) fail immediately
      if (!err.message?.includes('timed out')) throw err;
    }
  }

  throw lastError;
}

async function resolveOnce(query: string): Promise<any> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`yt-dlp timed out after ${YTDLP_TIMEOUT_MS / 1000} seconds`)),
      YTDLP_TIMEOUT_MS
    )
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

  return info.entries ? info.entries[0] : info;
}

// Picks the best audio-only stream URL (+ its required HTTP headers) from
// yt-dlp's format list. The headers matter: googlevideo.com signs URLs to
// the request context yt-dlp used (UA, referer, sometimes cookies), and a
// bare URL handed to ffmpeg without them gets 403'd.
function extractStreamFormat(data: any): { url: string; headers?: Record<string, string> } {
  if (data.url && !data.formats) {
    return { url: data.url, headers: data.http_headers };
  }

  const formats: any[] = data.formats ?? [];

  const audioOnly = formats
    .filter(f => f.acodec !== 'none' && f.vcodec === 'none')
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));

  if (audioOnly.length > 0) {
    return { url: audioOnly[0].url, headers: audioOnly[0].http_headers ?? data.http_headers };
  }

  return { url: data.url, headers: data.http_headers };
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
    return url;
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
    flatPlaylist: true,
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
    streamUrl: '',
    duration: entry.duration ?? 0,
    thumbnail: entry.thumbnail ?? entry.thumbnails?.[0]?.url ?? '',
    requestedBy,
    prefetched: false,
  }));
}