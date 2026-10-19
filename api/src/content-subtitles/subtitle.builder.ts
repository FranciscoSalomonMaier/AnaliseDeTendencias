import { randomUUID } from 'node:crypto';
import type { SpeechAlignmentResult } from './speech-alignment.provider';
import { TimedTextSchema } from './subtitle.schema';
import { narrationTextHash } from '../content-narration/tts-settings';
import type { ContentProject } from '../content-projects/content-project.schema';
import type { RenderSnapshot } from '../video-render/render-job';
import {
  SubtitleSettings,
  TimedText,
  SubtitleSegment,
  SubtitleVersion,
  SubtitleProjectState,
  SubtitleSnapshot,
  validateSegments,
} from './subtitle.schema';
export function groupWords(
  words: TimedText[],
  settings: SubtitleSettings,
): SubtitleSegment[] {
  const groups: TimedText[][] = [];
  let current: TimedText[] = [];
  for (const w of words) {
    const prev = current.at(-1);
    if (
      prev &&
      (current.length >= settings.maxWords ||
        current.map((x) => x.text).join(' ').length + w.text.length + 1 >
          settings.maxCharacters ||
        w.endSeconds - current[0].startSeconds > settings.maxDurationSeconds ||
        w.startSeconds - prev.endSeconds >= settings.pauseSeconds ||
        /[.!?;:]$/.test(prev.text))
    ) {
      groups.push(current);
      current = [];
    }
    current.push({ ...w });
  }
  if (current.length) groups.push(current);
  return groups.map((g, i) => ({
    id: randomUUID(),
    order: i + 1,
    text: g.map((w) => w.text).join(' '),
    startSeconds: g[0].startSeconds,
    endSeconds: g.at(-1)!.endSeconds,
    words: g,
  }));
}
export function prepareAlignment(
  result: SpeechAlignmentResult,
  settings: SubtitleSettings,
  duration: number,
) {
  const check = (items: TimedText[]) => {
    let last = 0;
    if (!items.length || items.length > 10000)
      throw Error('Quantidade de timestamps inválida.');
    for (const item of items) {
      TimedTextSchema.parse(item);
      if (
        item.startSeconds < last ||
        item.endSeconds <= item.startSeconds ||
        Math.round(item.endSeconds * 100) <=
          Math.round(item.startSeconds * 100) ||
        item.endSeconds > duration + 0.001
      )
        throw Error('Provider retornou timestamps inválidos.');
      last = item.endSeconds;
    }
  };
  let alignmentNote: string | undefined;
  if (result.words?.length) {
    try {
      check(result.words);
      const segments = groupWords(result.words, settings);
      validateSegments(segments, duration);
      return {
        segments,
        words: structuredClone(result.words),
        granularity: 'WORD' as const,
        alignmentNote,
      };
    } catch {
      alignmentNote =
        'Timestamps de palavras inválidos; foram usados segmentos reais do provider. Revise a sincronização.';
    }
  }
  check(result.segments);
  const segments = result.segments.map((s, i) => ({
    ...s,
    id: randomUUID(),
    order: i + 1,
  }));
  validateSegments(segments, duration);
  return {
    segments,
    words: undefined,
    granularity: 'SEGMENT' as const,
    alignmentNote,
  };
}
export function matchText(reference: string, transcript: string) {
  const tokenize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const a = tokenize(reference),
    b = tokenize(transcript);
  if (!a.length) return null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    prev = next;
  }
  return Math.max(0, 1 - prev[b.length] / Math.max(a.length, b.length));
}
export function subtitleSnapshot(
  timeline: RenderSnapshot,
  p: ContentProject,
  state: SubtitleProjectState,
  versions: SubtitleVersion[],
) {
  const snapshot: SubtitleSnapshot = {
    settings: structuredClone(state.settings),
    versions: [],
    segments: [],
  };
  const issues: Array<{
    sceneId: string | null;
    order: number | null;
    message: string;
  }> = [];
  if (!state.settings.enabled) return { snapshot, issues };
  for (const scene of timeline.scenes) {
    const v = versions.find(
      (v) =>
        v.id === state.selections[scene.sceneId] &&
        v.audioAssetId === scene.audioAssetId &&
        v.sceneId === scene.sceneId &&
        v.projectId === p.id &&
        v.status === 'READY',
    );
    const original = p.scenes.find((s) => s.id === scene.sceneId);
    if (!v) {
      issues.push({
        sceneId: scene.sceneId,
        order: scene.order,
        message: 'Gere ou selecione legendas para a narração atual.',
      });
      continue;
    }
    if (v.data.referenceHash !== narrationTextHash(original?.narration ?? ''))
      issues.push({
        sceneId: scene.sceneId,
        order: scene.order,
        message:
          'Legendas de uma versão anterior do texto. Revise e confirme as legendas.',
      });
    try {
      validateSegments(v.data.segments, scene.audioDurationSeconds);
    } catch {
      issues.push({
        sceneId: scene.sceneId,
        order: scene.order,
        message: 'Timestamps de legendas inválidos.',
      });
      continue;
    }
    snapshot.versions.push({
      id: v.id,
      sceneId: scene.sceneId,
      audioAssetId: scene.audioAssetId,
      granularity: v.data.granularity,
    });
    // Current renderer places narration at offset zero and uses CUT without overlaps.
    snapshot.segments.push(
      ...v.data.segments.map((s) => ({
        ...structuredClone(s),
        sceneId: scene.sceneId,
        startSeconds: scene.startSeconds + s.startSeconds,
        endSeconds: scene.startSeconds + s.endSeconds,
        words: s.words?.map((w) => ({
          ...w,
          startSeconds: scene.startSeconds + w.startSeconds,
          endSeconds: scene.startSeconds + w.endSeconds,
        })),
      })),
    );
  }
  return { snapshot, issues };
}
