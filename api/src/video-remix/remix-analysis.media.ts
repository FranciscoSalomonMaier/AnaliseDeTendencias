import { Injectable } from '@nestjs/common';
import { chmod, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { MediaProcess } from '../video-render/media-process';
import { RemixAnalysisSettings } from './remix-analysis.settings';
import {
  frameTimes,
  type AnalysisConfig,
  type Segment,
} from './remix-analysis.schema';
const probeSchema = z.object({
  format: z.object({ duration: z.string() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
    }),
  ),
});
@Injectable()
export class RemixAnalysisMedia {
  constructor(
    private readonly settings: RemixAnalysisSettings,
    private readonly process: MediaProcess,
  ) {}
  async hash(path: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path))
      hash.update(chunk as Buffer);
    return hash.digest('hex');
  }
  async metadata(path: string, signal: AbortSignal) {
    const data = probeSchema.parse(
      JSON.parse(
        await this.process.run(
          this.settings.ffprobe,
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-show_entries',
            'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate',
            '-of',
            'json',
            path,
          ],
          30000,
          signal,
        ),
      ),
    );
    const v = data.streams.find((s) => s.codec_type === 'video'),
      a = data.streams.find((s) => s.codec_type === 'audio');
    const duration = Number(data.format.duration);
    if (!v?.width || !v.height || !Number.isFinite(duration) || duration <= 0)
      throw new Error('Metadados do vídeo inválidos.');
    return {
      duration,
      width: v.width,
      height: v.height,
      videoCodec: v.codec_name ?? null,
      audioCodec: a?.codec_name ?? null,
      hasAudio: Boolean(a),
      aspectRatio: v.width / v.height,
    };
  }
  async cuts(
    path: string,
    duration: number,
    c: AnalysisConfig,
    signal: AbortSignal,
  ) {
    if (!c.cuts) return [];
    const out = await this.process.run(
      this.settings.ffmpeg,
      [
        '-hide_banner',
        '-v',
        'error',
        '-nostdin',
        '-max_alloc',
        '67108864',
        '-threads',
        '1',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        path,
        '-t',
        String(duration),
        '-an',
        '-sn',
        '-dn',
        '-vf',
        `scale=160:-2,select='gt(scene,${c.cutThreshold})',metadata=mode=print:file=-`,
        '-filter_threads',
        '1',
        '-f',
        'null',
        '-',
      ],
      300000,
      signal,
    );
    return [...out.matchAll(/pts_time:([\d.]+)/g)]
      .map((m) => Number(m[1]))
      .filter((x) => x > 0 && x < duration);
  }
  async frames(
    path: string,
    dir: string,
    segment: Segment,
    c: AnalysisConfig,
    signal: AbortSignal,
  ) {
    const frames: Array<{
      timestamp: number;
      data: Buffer;
      width: number;
      height: number;
      hash: string;
    }> = [];
    let last: Buffer | undefined;
    for (const [index, timestamp] of frameTimes(
      segment,
      c.framesPerSegment,
    ).entries()) {
      const dest = join(dir, `frame-${index}.jpg`);
      await this.process.run(
        this.settings.ffmpeg,
        [
          '-hide_banner',
          '-v',
          'error',
          '-nostdin',
          '-max_alloc',
          '67108864',
          '-threads',
          '1',
          '-ss',
          timestamp.toFixed(6),
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          path,
          '-frames:v',
          '1',
          '-an',
          '-sn',
          '-dn',
          '-vf',
          `scale=${c.edge}:${c.edge}:force_original_aspect_ratio=decrease`,
          '-filter_threads',
          '1',
          '-q:v',
          '5',
          '-y',
          dest,
        ],
        30000,
        signal,
      );
      await chmod(dest, 0o600);
      const data = await readFile(dest);
      if (data.length > 2 * 1024 * 1024)
        throw new Error('Frame excede limite de tamanho.');
      const pixels = await sharp(data)
        .resize(16, 16, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer();
      if (
        last &&
        pixels.reduce((n, v, i) => n + Math.abs(v - last![i]), 0) /
          pixels.length <
          2
      )
        continue;
      const info = await sharp(data).metadata();
      frames.push({
        timestamp,
        data,
        width: info.width,
        height: info.height,
        hash: createHash('sha256').update(data).digest('hex'),
      });
      last = pixels;
    }
    if (!frames.length) throw new Error('Nenhum frame válido foi extraído.');
    return frames;
  }
}
