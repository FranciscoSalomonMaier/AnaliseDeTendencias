import { stat, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';
import { MediaProcess } from '../../video-render/media-process';
import {
  RemixVideoValidator,
  videoMimes,
  fpsValue,
} from '../../video-remix/remix-video.validator';
import { ResourceAudioSourceValidator } from '../resources/audio/audio-source.validator';
import { assertAlignedOriginalStreams } from '../resources/audio/audio-duration';
import type { PlanningInput } from '../planning/planning.schema';
import {
  ExecutionFailure,
  type ExecutionVideoMetadata,
} from './execution.schema';
export interface ExecutionBinaries {
  ffmpegPath: string;
  ffprobePath: string;
}
interface Stream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  start_time?: string;
  duration?: string;
  nb_read_frames?: string;
  sample_aspect_ratio?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}
interface Probe {
  format?: { duration?: string };
  streams?: Stream[];
}
export async function probeMedia(
  process: MediaProcess,
  binaries: ExecutionBinaries,
  path: string,
  signal: AbortSignal,
  countFrames = false,
): Promise<Probe> {
  return JSON.parse(
    await process.run(
      binaries.ffprobePath,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        ...(countFrames ? ['-count_frames'] : []),
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        path,
      ],
      15000,
      signal,
    ),
  );
}
export function readVideoMetadata(probe: Probe): ExecutionVideoMetadata {
  if (!Array.isArray(probe.streams) || probe.streams.length > 16)
    throw new ExecutionFailure(
      'STREAMS_INVALID',
      'Streams de mídia inválidos.',
    );
  const videos = probe.streams.filter((s) => s.codec_type === 'video'),
    audios = probe.streams.filter((s) => s.codec_type === 'audio');
  if (videos.length !== 1 || audios.length > 1)
    throw new ExecutionFailure(
      'STREAMS_AMBIGUOUS',
      'A execução exige um vídeo e no máximo uma faixa original.',
    );
  const v = videos[0],
    a = audios[0];
  const duration = Number(v.duration ?? probe.format?.duration),
    start = Number(v.start_time ?? NaN),
    fps = fpsValue(v.avg_frame_rate ?? '');
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(start) ||
    !Number.isFinite(fps) ||
    !v.width ||
    !v.height ||
    !v.codec_name ||
    !v.pix_fmt ||
    !/^\w+$/.test(v.pix_fmt)
  )
    throw new ExecutionFailure(
      'METADATA_INVALID',
      'Metadados de vídeo ausentes ou inválidos.',
    );
  if (v.r_frame_rate && Math.abs(fpsValue(v.r_frame_rate) - fps) > 0.01)
    throw new ExecutionFailure(
      'VARIABLE_FRAME_RATE',
      'Origem com taxa de frames variável exige preparação explícita antes do planejamento.',
    );
  if (
    (v.tags?.rotate && Number(v.tags.rotate) !== 0) ||
    v.side_data_list?.some((s) => s.rotation !== undefined && s.rotation !== 0)
  )
    throw new ExecutionFailure(
      'ROTATION_UNSUPPORTED',
      'Rotação da origem exige preparação explícita antes do planejamento.',
    );
  if (
    v.sample_aspect_ratio &&
    !['1:1', 'N/A', '0:1'].includes(v.sample_aspect_ratio)
  )
    throw new ExecutionFailure(
      'ASPECT_UNSUPPORTED',
      'Pixels não quadrados exigem preparação explícita.',
    );
  return {
    duration,
    width: v.width,
    height: v.height,
    fps,
    videoCodec: v.codec_name,
    pixelFormat: v.pix_fmt,
    hasAudio: !!a,
    audioCodec: a?.codec_name ?? null,
    sampleRate: a ? Number(a.sample_rate) : null,
    channels: a?.channels ?? 0,
    frames: Number(v.nb_read_frames ?? 0),
    videoStart: start,
    audioStart: a ? Number(a.start_time ?? NaN) : null,
  };
}
export function compareVideoMetadata(
  actual: ExecutionVideoMetadata,
  expected: PlanningInput['videos'][number],
) {
  const e = expected.metadata;
  if (
    Math.abs(actual.duration - e.duration) > 1 / 30 + 1e-6 ||
    actual.width !== e.width ||
    actual.height !== e.height ||
    Math.abs(actual.fps - e.fps) > 0.01 ||
    actual.hasAudio !== expected.hasAudio ||
    (expected.codec && actual.videoCodec !== expected.codec)
  )
    throw new ExecutionFailure(
      'SOURCE_METADATA_CHANGED',
      'Os metadados reais diferem do planejamento. Refaça a análise antes de executar.',
    );
  if (actual.hasAudio) {
    if (
      actual.audioCodec !== expected.audio?.codec ||
      actual.sampleRate !== expected.audio?.sampleRate ||
      actual.channels !== expected.audio?.channels
    )
      throw new ExecutionFailure(
        'SOURCE_AUDIO_CHANGED',
        'A faixa sonora real difere dos metadados planejados.',
      );
  }
}
export async function decodeIntegrity(
  process: MediaProcess,
  binaries: ExecutionBinaries,
  path: string,
  signal: AbortSignal,
  audioOnly = false,
) {
  let decoded = 0;
  await process.run(
    binaries.ffmpegPath,
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
      '-noautorotate',
      '-i',
      path,
      '-map',
      audioOnly ? '0:a:0' : '0:v:0',
      ...(!audioOnly ? ['-map', '0:a:0?'] : []),
      '-sn',
      '-dn',
      '-t',
      '601',
      '-progress',
      'pipe:1',
      '-nostats',
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
  if (!Number.isFinite(decoded) || decoded <= 0)
    throw new ExecutionFailure(
      'DECODE_INVALID',
      'Não foi possível decodificar toda a mídia.',
    );
  return decoded;
}
export async function preflightVideo(
  process: MediaProcess,
  binaries: ExecutionBinaries,
  validator: RemixVideoValidator,
  path: string,
  expected: PlanningInput['videos'][number],
  signal: AbortSignal,
) {
  const file = await stat(path),
    ext = extname(path).slice(1).toLowerCase();
  if (!videoMimes[ext])
    throw new ExecutionFailure(
      'VIDEO_FORMAT',
      'Formato real incompatível com vídeo.',
    );
  await validator.validate(
    {
      path,
      originalname: 'source.' + ext,
      mimetype: videoMimes[ext][0],
      size: file.size,
    },
    signal,
  );
  const actual = readVideoMetadata(
    await probeMedia(process, binaries, path, signal),
  );
  compareVideoMetadata(actual, expected);
  const decoded = await decodeIntegrity(process, binaries, path, signal);
  if (
    Math.abs(decoded - actual.duration) >
    Math.max(
      1 / actual.fps,
      actual.hasAudio ? 2048 / (actual.sampleRate ?? 48000) : 0,
    ) +
      0.01
  )
    throw new ExecutionFailure(
      'VIDEO_DECODE_DURATION',
      'A duração decodificada da fonte é incompatível.',
    );
  return actual;
}
export async function preflightAudio(
  process: MediaProcess,
  binaries: ExecutionBinaries,
  videos: RemixVideoValidator,
  path: string,
  expected: PlanningInput['audios'][number],
  signal: AbortSignal,
) {
  const actual = await new ResourceAudioSourceValidator(
      process,
      binaries,
      videos,
    ).validate(expected.metadata.id, path, 'AUDIO', signal),
    e = expected.metadata;
  if (
    actual.codec !== e.codec ||
    actual.sampleRate !== e.sampleRate ||
    actual.channels !== e.channels ||
    Math.abs(actual.duration - e.duration) >
      Math.max(1 / 30, 2048 / e.sampleRate)
  )
    throw new ExecutionFailure(
      'AUDIO_METADATA_CHANGED',
      'Metadados reais de áudio divergem do planejamento.',
    );
  return actual;
}
export async function preflightImage(
  path: string,
  expected: PlanningInput['images'][number],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const bytes = await readFile(path);
  const signature =
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!signature)
    throw new ExecutionFailure(
      'IMAGE_SIGNATURE',
      'Assinatura da imagem incompatível.',
    );
  const m = await sharp(bytes, {
    limitInputPixels: 4096 ** 2,
    animated: false,
  }).metadata();
  signal.throwIfAborted();
  if (
    !['png', 'jpeg', 'webp'].includes(m.format ?? '') ||
    (m.pages ?? 1) !== 1 ||
    m.width !== expected.width ||
    m.height !== expected.height
  )
    throw new ExecutionFailure(
      'IMAGE_METADATA_CHANGED',
      'Imagem incompatível com os metadados planejados.',
    );
}
export function requireAlignedOriginal(actual: ExecutionVideoMetadata) {
  assertAlignedOriginalStreams(actual.audioStart, actual.videoStart);
}
