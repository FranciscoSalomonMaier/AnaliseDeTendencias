import { assertAlignedOriginalStreams } from './audio-duration';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { MediaProcess } from '../../../video-render/media-process';
import { RenderSettings } from '../../../video-render/render-settings';
import {
  RemixVideoValidator,
  videoMimes,
} from '../../../video-remix/remix-video.validator';
import { ShortMusicValidator } from '../../short-music.service';
import { ShortSettings } from '../../short.settings';
import { audioLimits, type AudioSourceMetadata } from './audio.schema';
export class ResourceAudioSourceValidator {
  constructor(
    readonly process: MediaProcess,
    readonly settings: Pick<RenderSettings, 'ffmpegPath' | 'ffprobePath'>,
    readonly videos: RemixVideoValidator,
  ) {}
  async validate(
    id: string,
    path: string,
    kind: 'AUDIO' | 'VIDEO',
    signal?: AbortSignal,
  ): Promise<AudioSourceMetadata> {
    const file = await stat(path),
      extension = extname(path).slice(1).toLowerCase();
    if (
      !file.isFile() ||
      !file.size ||
      file.size >
        (kind === 'VIDEO' ? audioLimits.videoBytes : audioLimits.sourceBytes)
    )
      throw Error('Fonte inválida ou acima do limite.');
    if (kind === 'AUDIO') {
      // Reuse the upload validator's signature, container, codec and full decode integrity checks.
      const scoped = new MediaProcess();
      scoped.run = (binary, args, timeout, _signal, progress) =>
        this.process.run(binary, args, timeout, signal, progress);
      const music = new ShortMusicValidator(
        {
          musicMaxBytes: audioLimits.sourceBytes,
          musicMaxSeconds: 600,
        } as ShortSettings,
        scoped,
        this.settings as RenderSettings,
      );
      const checked = await music.validate({
        path,
        originalname: 'source.' + (extension === 'opus' ? 'ogg' : extension),
        mimetype:
          extension === 'opus' ? 'audio/ogg' : 'application/octet-stream',
        size: file.size,
      });
      if (
        checked.sampleRate < 8000 ||
        checked.sampleRate > 192000 ||
        checked.channels > 8
      )
        throw Error('Formato de canais ou amostragem incompatível.');
      return {
        id,
        kind,
        duration: checked.duration,
        sampleRate: checked.sampleRate,
        channels: checked.channels,
        codec: checked.codec,
      };
    }
    const mimetype = videoMimes[extension]?.[0];
    if (!mimetype) throw Error('Formato de vídeo não autorizado.');
    const checked = await this.videos.validate(
      { path, originalname: 'source.' + extension, mimetype, size: file.size },
      signal,
    );
    if (
      checked.durationSeconds > 600 ||
      checked.width * checked.height > 3840 * 2160
    )
      throw Error('Vídeo acima dos limites.');
    const raw = JSON.parse(
      await this.process.run(
        this.settings.ffprobePath,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_entries',
          'stream=codec_type,codec_name,sample_rate,channels,start_time',
          '-of',
          'json',
          path,
        ],
        15000,
        signal,
      ),
    );
    if (!Array.isArray(raw.streams) || raw.streams.length > 16)
      throw Error('Streams inválidos.');
    const audio = raw.streams.find((s) => s.codec_type === 'audio'),
      video = raw.streams.find((s) => s.codec_type === 'video');
    if (
      !audio ||
      !audio.codec_name ||
      !Number.isFinite(Number(audio.sample_rate)) ||
      Number(audio.sample_rate) < 8000 ||
      Number(audio.sample_rate) > 192000 ||
      !Number.isInteger(audio.channels) ||
      audio.channels < 1 ||
      audio.channels > 8
    )
      throw Error('Vídeo sem uma faixa de áudio compatível.');
    assertAlignedOriginalStreams(audio.start_time, video?.start_time);
    let decoded = 0;
    await this.process.run(
      this.settings.ffmpegPath,
      [
        '-hide_banner',
        '-v',
        'error',
        '-nostdin',
        '-xerror',
        '-err_detect',
        'explode',
        '-threads',
        '1',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        path,
        '-map',
        '0:a:0',
        '-af',
        'asetpts=N/SR/TB',
        '-t',
        '601',
        '-progress',
        'pipe:1',
        '-nostats',
        '-vn',
        '-sn',
        '-dn',
        '-f',
        'null',
        '-',
      ],
      120000,
      signal,
      (s) => {
        decoded = s;
      },
    );
    if (decoded <= 0 || decoded > 600)
      throw Error('Duração decodificada inválida.');
    return {
      id,
      kind,
      duration: decoded,
      sampleRate: Number(audio.sample_rate),
      channels: audio.channels,
      codec: audio.codec_name,
    };
  }
}
