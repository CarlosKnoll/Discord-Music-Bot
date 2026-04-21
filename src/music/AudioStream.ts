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

export function createStream(streamUrl: string, volume: number = 1.0): AudioStreamResult {
  const ffmpegArgs = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '10',
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
    windowsHide: true,  // fix #2
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && (msg.includes('Error') || msg.includes('Invalid'))) {
      // Suppress the pipe-closed race condition noise
      if (msg.includes('Error writing trailer') || msg.includes('Error closing file')) return;
      console.error(`[FFmpeg] ${msg}`);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[FFmpeg] Failed to spawn process:', err.message);
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0 && code !== null && code !== 255) {
      console.warn(`[FFmpeg] Exited with code ${code}`);
    }
  });

  const resource = createAudioResource(ffmpeg.stdout as Readable, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });

  return { resource, ffmpeg };
}