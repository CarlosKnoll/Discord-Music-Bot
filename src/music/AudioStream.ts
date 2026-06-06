import {
  createAudioResource,
  AudioResource,
  StreamType,
} from '@discordjs/voice';
import { spawn } from 'child_process';
import { Readable } from 'stream';

export interface AudioStreamResult {
  resource: AudioResource;
  ffmpeg: ReturnType<typeof spawn>;
}

// Number of PCM chunks to buffer before handing the stream to Discord.
// Each chunk is typically 4096 bytes; at 48kHz s16le stereo that's ~21ms per
// chunk, so 10 chunks ≈ 200ms of headroom to absorb TLS reconnect hiccups
// without producing audible skips.
const BUFFER_CHUNKS = 10;

export function createStream(streamUrl: string, volume: number = 1.0): Promise<AudioStreamResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const ffmpegArgs = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_on_http_error', '4xx,5xx',
      '-reconnect_delay_max', '10',
      '-probesize', '32768',
      '-analyzeduration', '0',
      '-i', streamUrl,
      '-af', `dynaudnorm=g=5:f=250:r=0.9:p=0.7,volume=${volume}`,
      '-vn',
      '-ar', '48000',
      '-ac', '2',
      '-f', 's16le',
      '-loglevel', 'error',
      'pipe:1',
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      windowsHide: true,
    });

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && (msg.includes('Error') || msg.includes('Invalid'))) {
        if (msg.includes('Error writing trailer') || msg.includes('Error closing file')) return;
        console.error(`[FFmpeg] ${msg}`);
      }
    });

    ffmpeg.on('error', (err) => {
      console.error('[FFmpeg] Failed to spawn process:', err.message);
      settle(() => reject(err));
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null && code !== 255) {
        console.warn(`[FFmpeg] Exited with code ${code}`);
        settle(() => reject(new Error(`FFmpeg exited with code ${code}`)));
      }
    });

    const stdout = ffmpeg.stdout as Readable;
    const buffered: Buffer[] = [];

    const onData = (chunk: Buffer) => {
      buffered.push(chunk);
      if (buffered.length < BUFFER_CHUNKS) return;

      stdout.removeListener('data', onData);
      stdout.removeListener('error', onError);
      stdout.pause();

      // Combine buffered chunks and prepend them to a pass-through Readable so
      // createAudioResource sees a continuous stream starting from the first byte.
      const combined = Buffer.concat(buffered);
      const readable = new Readable({ read() {} });
      readable.push(combined);
      stdout.on('data', (c: Buffer) => readable.push(c));
      stdout.on('end', () => readable.push(null));
      stdout.on('error', (e: Error) => readable.destroy(e));
      stdout.resume();

      const resource = createAudioResource(readable, {
        inputType: StreamType.Raw,
        inlineVolume: true,
      });

      resource.volume?.setVolume(volume);
      settle(() => resolve({ resource, ffmpeg }));
    };

    const onError = (err: Error) => {
      stdout.removeListener('data', onData);
      settle(() => reject(err));
    };

    stdout.on('data', onData);
    stdout.once('error', onError);
  });
}