import { PlanningValidationError } from './planning-diagnostics';
import { compileResourceComposition } from '../resources/editing-resource.compiler';
import {
  resourceDuration,
  resourceInterval,
  toFrames,
  toSeconds,
} from '../resources/editing-resource.duration';
import { validateResourceUsage } from '../resources/editing-resource.validator';
import type { PlanningContext } from './planning-context';
import type { PlanningResponse } from './planning.schema';
export interface PlannedSpan {
  clipId: string;
  sourceId: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  duration: number;
  kind: 'PLAY' | 'FREEZE';
}
type Piece = Omit<PlannedSpan, 'timelineStart'>;
interface State {
  frames: number;
  pieces: Array<Piece & { at: number }>;
}
/** Pure compiler invocation for contextual checks, never execution. Filter strings are
 * discarded. The original resource math is the authority for all duration changes. */
export function validateVisualTimeline(
  plan: PlanningResponse,
  context: PlanningContext,
) {
  const ids = new Set<string>();
  const cuts = new Set<string>();
  const assets = plan.clips.map((c) => {
    if (ids.has(c.clipId))
      throw new PlanningValidationError(
        'DUPLICATE_REFERENCE',
        'Clipes duplicados.',
      );
    ids.add(c.clipId);
    const source = context.input.videos.find(
      (v) => v.metadata.id === c.sourceId,
    );
    if (!source)
      throw new PlanningValidationError(
        'SOURCE_UNAUTHORIZED',
        'Fonte de vídeo não autorizada.',
      );
    return { ...source.metadata, id: c.clipId };
  });
  const usages = plan.visualOperations.map((o) =>
    validateResourceUsage(o.usage, context.capabilities),
  );
  for (const u of usages) {
    if (u.resourceId === 'CUT') {
      if (u.target.scope !== 'SOURCE_INTERVAL')
        throw new PlanningValidationError(
          'PLAN_INCOMPATIBLE',
          'CUT exige relógio original.',
        );
      const clip = plan.clips.find(
        (c) => c.clipId === (u.target as { sourceId: string }).sourceId,
      );
      const source = context.input.videos.find(
        (v) => v.metadata.id === clip?.sourceId,
      );
      const { start, end } = u.target;
      if (
        !source ||
        !source.usableIntervals.some((i) => start >= i.start && end <= i.end)
      )
        throw new PlanningValidationError(
          'SOURCE_UNAUTHORIZED',
          'Corte fora dos intervalos autorizados.',
        );
      cuts.add(u.target.sourceId);
    }
  }
  if (plan.clips.some((c) => !cuts.has(c.clipId)))
    throw new PlanningValidationError(
      'PLAN_INCOMPATIBLE',
      'Cada clip exige CUT explícito.',
    );
  const compiled = compileResourceComposition(
    {
      contractVersion: 1,
      operations: plan.visualOperations.map((o) => o.usage),
    },
    assets,
    context.capabilities,
    {
      width: context.input.target.width,
      height: context.input.target.height,
      fps: 30,
    },
  );
  if (
    Math.abs(compiled.expectedDuration - plan.durationSeconds) >
    0.5 / 30 + 1e-6
  )
    throw new PlanningValidationError(
      'DURATION_INVALID',
      'Duração visual diferente da duração planejada.',
    );
  const states = new Map<string, State>();
  for (const usage of usages) {
    const t = usage.target;
    const refs =
      t.scope === 'SOURCE_INTERVAL'
        ? [t.sourceId]
        : t.scope === 'BETWEEN_CLIPS'
          ? [t.fromClipId, t.toClipId]
          : t.scope === 'COMPOSITION'
            ? (t.clipIds ?? [t.clipId!])
            : [t.clipId];
    for (const id of refs)
      if (!states.has(id)) {
        const asset = assets.find((a) => a.id === id)!;
        const clip = plan.clips.find((c) => c.clipId === id)!;
        states.set(id, {
          frames: toFrames(asset.duration),
          pieces: [
            {
              clipId: id,
              sourceId: clip.sourceId,
              sourceStart: 0,
              sourceEnd: asset.duration,
              at: 0,
              duration: toSeconds(toFrames(asset.duration)),
              kind: 'PLAY',
            },
          ],
        });
      }
    const inputs = refs.map((id) => states.get(id)!);
    const impact = resourceDuration(
      usage,
      inputs.map((s, i) =>
        usage.resourceId === 'CUT'
          ? assets.find((a) => a.id === refs[i])!.duration
          : toSeconds(s.frames),
      ),
    );
    const current = inputs[0],
      range = resourceInterval(usage, current.frames);
    let pieces = current.pieces;
    if (usage.resourceId === 'CUT')
      pieces = slice(current, toSeconds(range.start), toSeconds(range.end));
    else if (usage.resourceId === 'SPEED_CHANGE') {
      const begin = toSeconds(range.start),
        end = toSeconds(range.end);
      const length =
        impact.outputSeconds -
        toSeconds(current.frames - (range.end - range.start));
      pieces = append([
        slice(current, 0, begin),
        stretch(slice(current, begin, end), length),
        slice(current, end, toSeconds(current.frames)),
      ]);
    } else if (usage.resourceId === 'FREEZE_FRAME') {
      const at = usage.parameters.at,
        p = current.pieces.find((p) => at >= p.at && at < p.at + p.duration)!;
      const sourceAt =
        p.sourceStart +
        ((p.sourceEnd - p.sourceStart) * (at - p.at)) / p.duration;
      pieces = [
        {
          ...p,
          at: 0,
          sourceStart: sourceAt,
          sourceEnd: sourceAt,
          duration: impact.outputSeconds,
          kind: 'FREEZE',
        },
      ];
    } else if (usage.resourceId === 'REPEAT_SEGMENT') {
      const begin = toSeconds(range.start),
        end = toSeconds(range.end);
      pieces = append([
        slice(current, 0, begin),
        ...Array.from({ length: usage.parameters.count }, () =>
          slice(current, begin, end),
        ),
        slice(current, end, toSeconds(current.frames)),
      ]);
    } else if (refs.length > 1) {
      let offset = 0;
      pieces = [];
      for (const [index, state] of inputs.entries()) {
        if (index) offset -= impact.overlapSeconds;
        pieces.push(...state.pieces.map((p) => ({ ...p, at: p.at + offset })));
        offset += toSeconds(state.frames);
      }
    }
    states.set(refs[0], { frames: toFrames(impact.outputSeconds), pieces });
    for (const id of refs.slice(1)) states.delete(id);
  }
  const spans: PlannedSpan[] = states
    .get(compiled.outputClipId)!
    .pieces.map(({ at, ...p }) => ({ ...p, timelineStart: at }));
  return {
    outputClipId: compiled.outputClipId,
    duration: compiled.expectedDuration,
    frames: compiled.expectedFrames,
    spans,
    impacts: compiled.impacts,
  };
}
function slice(state: State, start: number, end: number): State['pieces'] {
  if (end <= start) return [];
  return state.pieces.flatMap((p) => {
    const a = Math.max(start, p.at),
      b = Math.min(end, p.at + p.duration);
    if (b <= a) return [];
    const ratio = (p.sourceEnd - p.sourceStart) / p.duration;
    return [
      {
        ...p,
        at: a - start,
        duration: b - a,
        sourceStart: p.sourceStart + (a - p.at) * ratio,
        sourceEnd: p.sourceStart + (b - p.at) * ratio,
      },
    ];
  });
}
function stretch(pieces: State['pieces'], duration: number) {
  const total = Math.max(...pieces.map((p) => p.at + p.duration));
  return pieces.map((p) => ({
    ...p,
    at: (p.at * duration) / total,
    duration: (p.duration * duration) / total,
  }));
}
function append(groups: State['pieces'][]) {
  let at = 0;
  const out: State['pieces'] = [];
  for (const group of groups) {
    out.push(...group.map((p) => ({ ...p, at: p.at + at })));
    at += Math.max(0, ...group.map((p) => p.at + p.duration));
  }
  return out;
}
