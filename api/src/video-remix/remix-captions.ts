import { randomUUID } from 'node:crypto';
import type { SubtitleSegment } from '../content-subtitles/subtitle.schema';
export function voicedIntervals(metadata: string, duration: number) {
  const silences: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  for (const m of metadata.matchAll(/lavfi\.silence_(start|end)=([\d.]+)/g)) {
    const time = Math.min(duration, Number(m[2]));
    if (m[1] === 'start') start = time;
    else {
      silences.push({ start: start ?? 0, end: time });
      start = undefined;
    }
  }
  if (start !== undefined) silences.push({ start, end: duration });
  const voiced: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor) voiced.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < duration) voiced.push({ start: cursor, end: duration });
  return voiced;
}
export function pauseAlignedCaptions(
  text: string,
  duration: number,
  intervals: Array<{ start: number; end: number }>,
  maxWords: number,
  maxChars: number,
): SubtitleSegment[] {
  const phrases: string[] = [],
    words = text.trim().split(/\s+/u);
  let current = '';
  for (const word of words) {
    if (
      current &&
      (current.split(' ').length >= maxWords ||
        current.length + word.length + 1 > maxChars)
    ) {
      phrases.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + word;
    if (/[.!?;:]$/.test(word)) {
      phrases.push(current);
      current = '';
    }
  }
  if (current) phrases.push(current);
  const speech = intervals.reduce((n, r) => n + r.end - r.start, 0);
  if (speech < 0.05 || !phrases.length)
    throw new Error(
      'Não foi detectada atividade de áudio suficiente para legendar.',
    );
  const weights = phrases.map(
    (p) =>
      Math.max(1, (p.match(/[aeiouáéíóúâêôãõ]/gi) ?? []).length) +
      p.length * 0.08,
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let offset = 0;
  const map = (t: number, end = false) => {
    let sum = 0;
    for (const i of intervals) {
      const size = i.end - i.start;
      if (t < sum + size || (end && t <= sum + size))
        return i.start + Math.min(size, t - sum);
      sum += size;
    }
    return intervals.at(-1)!.end;
  };
  return phrases
    .map((phrase, i) => {
      const start = map(offset);
      offset += (speech * weights[i]) / total;
      const end = Math.min(duration, map(offset, true));
      return {
        id: randomUUID(),
        order: i + 1,
        text: phrase,
        startSeconds: start,
        endSeconds: end,
      };
    })
    .filter((s) => s.endSeconds - s.startSeconds >= 0.02)
    .map((s, i) => ({ ...s, order: i + 1 }));
}
