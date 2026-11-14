import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { open, chmod } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';
import { MediaProcess, RenderFailure } from '../video-render/media-process';
import { RemixImportSettings, type RemixUpload } from './remix-import.settings';
export const videoMimes: Record<string, string[]> = {
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
  webm: ['video/webm'],
  mkv: ['video/x-matroska', 'video/matroska'],
};
export function fpsValue(value: string) {
  const m = /^(\d+)(?:\/(\d+))?$/.exec(value);
  if (!m) return NaN;
  return Number(m[1]) / Number(m[2] ?? 1);
}
@Injectable()
export class RemixVideoValidator {
  private running = 0;
  constructor(
    private readonly settings: RemixImportSettings,
    private readonly process: MediaProcess,
  ) {}
  async validate(file: RemixUpload, signal?: AbortSignal) {
    if (this.running >= 2)
      throw new ServiceUnavailableException(
        'Validações de vídeo em andamento. Aguarde e tente novamente.',
      );
    this.running++;
    try {
      if (!file.size || file.size > this.settings.maxBytes)
        throw new BadRequestException(
          'Arquivo vazio ou acima do limite de upload.',
        );
      const extension = extname(file.originalname).slice(1).toLowerCase();
      if (!videoMimes[extension]?.includes(file.mimetype))
        throw new BadRequestException(
          'Extensão e MIME devem corresponder a MP4, MOV, WebM ou MKV.',
        );
      await chmod(file.path, 0o600);
      const fd = await open(file.path, 'r');
      const header = Buffer.alloc(4096);
      let bytes = 0;
      try {
        bytes = (await fd.read(header, 0, 4096, 0)).bytesRead;
      } finally {
        await fd.close();
      }
      const iso = bytes >= 12 && header.toString('ascii', 4, 8) === 'ftyp';
      const ebml = bytes >= 4 && header.readUInt32BE(0) === 0x1a45dfa3;
      if (['mp4', 'mov'].includes(extension) ? !iso : !ebml)
        throw new BadRequestException(
          'O conteúdo real não corresponde ao formato informado.',
        );
      const raw = await this.process.run(
        this.settings.ffprobePath,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-count_packets',
          '-read_intervals',
          '%+1',
          '-show_entries',
          'format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_packets',
          '-of',
          'json',
          file.path,
        ],
        this.settings.timeoutMs,
        signal,
      );
      const parsed = z
        .object({
          format: z.object({ format_name: z.string(), duration: z.string() }),
          streams: z
            .array(
              z.object({
                codec_type: z.string().optional(),
                codec_name: z.string().optional(),
                width: z.number().optional(),
                height: z.number().optional(),
                avg_frame_rate: z.string().optional(),
                nb_read_packets: z.string().optional(),
              }),
            )
            .max(16),
        })
        .parse(JSON.parse(raw));
      const video = parsed.streams.find((s) => s.codec_type === 'video');
      if (
        !video ||
        !Number.isFinite(Number(video.nb_read_packets)) ||
        Number(video.nb_read_packets ?? 0) <= 0 ||
        !['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'prores'].includes(
          video.codec_name ?? '',
        )
      )
        throw new Error('codec');
      const durationSeconds = Number(parsed.format.duration),
        fps = fpsValue(video.avg_frame_rate ?? '');
      const width = video.width ?? 0,
        height = video.height ?? 0;
      if (
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > 86400 ||
        !Number.isFinite(fps) ||
        fps <= 0 ||
        fps > 240 ||
        width < 1 ||
        height < 1 ||
        width > 16384 ||
        height > 16384
      )
        throw new Error('metadata');
      const doc = header.toString('latin1', 0, bytes);
      if (
        extension === 'webm' &&
        (!parsed.format.format_name.includes('webm') || !doc.includes('webm'))
      )
        throw new Error('webm');
      if (
        extension === 'mkv' &&
        (!parsed.format.format_name.includes('matroska') ||
          !doc.includes('matroska'))
      )
        throw new Error('mkv');
      if (
        extension === 'mov' &&
        !header.toString('ascii', 8, 12).includes('qt')
      )
        throw new Error('mov');
      if (extension === 'mp4' && header.toString('ascii', 8, 12).includes('qt'))
        throw new Error('mp4');
      return {
        extension,
        mimeType: videoMimes[extension][0],
        durationSeconds,
        width,
        height,
        fps,
        codec: video.codec_name!,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      if (
        error instanceof RenderFailure &&
        error.publicMessage.includes('indisponível')
      )
        throw new ServiceUnavailableException(
          'FFprobe indisponível. Configure FFPROBE_PATH no servidor.',
        );
      throw new BadRequestException(
        'Vídeo corrompido, incompatível ou sem duração/resolução/FPS válidos.',
      );
    } finally {
      this.running--;
    }
  }
}
