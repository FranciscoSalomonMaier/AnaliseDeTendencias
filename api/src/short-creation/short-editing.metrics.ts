import type { SpeechAlignmentResult } from '../content-subtitles/speech-alignment.provider';
import { prepareAlignment } from '../content-subtitles/subtitle.builder';
import { defaultSubtitles } from '../content-subtitles/subtitle.schema';
import type { ReferenceProfile } from './short-editing.schema';
export function cutMetrics(
  raw: number[],
  duration: number,
): ReferenceProfile['cuts'] {
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error('Duração de referência inválida.');
  const cuts = [
    ...new Set(raw.filter((t) => Number.isFinite(t) && t > 0 && t < duration)),
  ].sort((a, b) => a - b);
  const points = [0, ...cuts, duration],
    lengths = points.slice(1).map((t, i) => t - points[i]),
    sorted = [...lengths].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  const mean = duration / lengths.length,
    median =
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: cuts.length,
    mean,
    median,
    perMinute: (cuts.length * 60) / duration,
    variation:
      Math.sqrt(
        lengths.reduce((n, t) => n + (t - mean) ** 2, 0) / lengths.length,
      ) / mean,
    pace:
      median < 1.5
        ? 'Muito dinâmico'
        : median < 3
          ? 'Dinâmico'
          : median < 6
            ? 'Moderado'
            : 'Lento',
    quarterCounts: Array.from(
      { length: 4 },
      (_, i) =>
        cuts.filter(
          (t) => t >= (i * duration) / 4 && t < ((i + 1) * duration) / 4,
        ).length,
    ),
  };
}
export function speechMetrics(
  result: SpeechAlignmentResult | null,
  duration: number,
): ReferenceProfile['speech'] {
  const unknown: ReferenceProfile['speech'] = {
    words: null,
    averageWpm: null,
    activeWpm: null,
    pauseCount: null,
    meanPause: null,
    granularity: null,
  };
  if (!result) return unknown;
  try {
    const aligned = prepareAlignment(result, defaultSubtitles(), duration),
      units = aligned.words ?? aligned.segments;
    const count =
      aligned.words?.length ??
      aligned.segments.reduce(
        (n, s) => n + (s.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0),
        0,
      );
    const active = units.reduce((n, t) => n + t.endSeconds - t.startSeconds, 0);
    let end = 0;
    const pauses: number[] = [];
    for (const unit of units) {
      if (unit.startSeconds - end > 0.12) pauses.push(unit.startSeconds - end);
      end = unit.endSeconds;
    }
    if (duration - end > 0.12) pauses.push(duration - end);
    return {
      words: count,
      averageWpm: (count * 60) / duration,
      activeWpm: active > 0 ? (count * 60) / active : null,
      pauseCount: pauses.length,
      meanPause: pauses.length
        ? pauses.reduce((a, b) => a + b) / pauses.length
        : 0,
      granularity: aligned.granularity,
    };
  } catch {
    return unknown;
  }
}
