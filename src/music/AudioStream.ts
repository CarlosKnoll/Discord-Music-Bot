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

export function createStream(streamUrl: string, volume: number = 1.0): Promise<AudioStreamResult> {
  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_on_http_error', '4xx,5xx',
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
      reject(err);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null && code !== 255) {
        console.warn(`[FFmpeg] Exited with code ${code}`);
      }
    });

    // Wait for the first real PCM chunk before handing the stream to Discord.
    // Without this, @discordjs/voice starts consuming the resource while FFmpeg
    // is still establishing the connection, causing its playback clock to advance
    // by 2-3 seconds before audio data actually arrives.
    const stdout = ffmpeg.stdout as Readable;

    const onFirstData = () => {
      stdout.removeListener('data', onFirstData);
      stdout.removeListener('error', onError);

      // Unshift the chunk back so it isn't lost — pause() then push() is cleaner
      // but Readable in flowing mode doesn't allow unshift; instead we simply
      // re-pause and let createAudioResource re-attach its own reader.
      stdout.pause();

      const resource = createAudioResource(stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true,
      });

      if (resource.volume) {
        resource.volume.setVolume(volume);
      }

      resolve({ resource, ffmpeg });
    };

    const onError = (err: Error) => {
      stdout.removeListener('data', onFirstData);
      reject(err);
    };

    stdout.once('data', onFirstData);
    stdout.once('error', onError);
  });
}