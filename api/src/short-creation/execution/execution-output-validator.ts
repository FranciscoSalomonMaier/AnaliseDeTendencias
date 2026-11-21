import { stat } from 'node:fs/promises';
import type { MediaProcess } from '../../video-render/media-process';
import { ExecutionFailure } from './execution.schema';
import {
  decodeIntegrity,
  probeMedia,
  readVideoMetadata,
  type ExecutionBinaries,
} from './execution-preflight';
export async function validateExecutionOutput(
  process: MediaProcess,
  binaries: ExecutionBinaries,
  path: string,
  expected: {
    duration: number;
    frames: number;
    width: number;
    height: number;
    hasAudio: boolean;
    maxBytes: number;
  },
  signal: AbortSignal,
) {
  const file = await stat(path);
  if (!file.isFile() || file.size <= 0 || file.size >= expected.maxBytes)
    throw new ExecutionFailure(
      'OUTPUT_SIZE',
      'Saída vazia ou no limite de tamanho permitido.',
    );
  const raw = await probeMedia(process, binaries, path, signal, true),
    actual = readVideoMetadata(raw);
  if (
    actual.videoCodec !== 'h264' ||
    actual.pixelFormat !== 'yuv420p' ||
    actual.width !== expected.width ||
    actual.height !== expected.height ||
    Math.abs(actual.fps - 30) > 0.01 ||
    actual.frames !== expected.frames ||
    Math.abs(actual.duration - expected.duration) > 0.5 / 30 + 1e-6 ||
    Math.abs(actual.videoStart) > 1 / 30
  )
    throw new ExecutionFailure(
      'OUTPUT_VIDEO_INVALID',
      'Saída incompatível com resolução, codec, frames, timestamps ou duração esperados.',
    );
  if (actual.hasAudio !== expected.hasAudio)
    throw new ExecutionFailure(
      'OUTPUT_AUDIO_INVALID',
      'Presença de áudio diferente da solicitada.',
    );
  if (actual.hasAudio) {
    const audio = raw.streams!.find((s) => s.codec_type === 'audio')!;
    if (
      actual.audioCodec !== 'aac' ||
      actual.sampleRate !== 48000 ||
      actual.channels !== 2 ||
      !Number.isFinite(actual.audioStart) ||
      Math.abs(actual.audioStart! - actual.videoStart) > 1 / 48000 ||
      Math.abs(Number(audio.duration) - expected.duration) >
        Math.max(1 / 30, 2048 / 48000)
    )
      throw new ExecutionFailure(
        'OUTPUT_AV_SYNC',
        'Formato ou duração do áudio incompatível com a composição audiovisual.',
      );
  }
  const decoded = await decodeIntegrity(process, binaries, path, signal);
  if (
    Math.abs(decoded - expected.duration) >
    Math.max(1 / 30, 2048 / 48000) + 0.01
  )
    throw new ExecutionFailure(
      'OUTPUT_DECODE_INVALID',
      'Decodificação final não cobre a composição.',
    );
  if (actual.hasAudio) {
    const audioDuration = await decodeIntegrity(
      process,
      binaries,
      path,
      signal,
      true,
    );
    if (Math.abs(audioDuration - expected.duration) > 2048 / 48000 + 0.01)
      throw new ExecutionFailure(
        'OUTPUT_AUDIO_TRUNCATED',
        'A faixa sonora final não cobre a duração planejada.',
      );
  }
  return { ...actual, bytes: file.size };
}
