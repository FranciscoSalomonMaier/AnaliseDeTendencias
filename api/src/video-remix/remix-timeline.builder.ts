import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type AssemblyConfig,
  type AssemblyData,
  type CutEdit,
  type AssemblyItem,
  type AssemblySegment,
} from './remix-assembly.schema';
import type { Evidence } from './remix-story.schema';
export interface AssemblyInput {
  scriptId: string;
  scriptVersion: number;
  scriptRevision: number;
  contextHash: string;
  targetDuration: number;
  segments: Array<{
    id: string;
    text: string;
    audioId: string;
    audioKey: string;
    audioFormat: string;
    audioBytes: number;
    audioDuration: number;
    refs: Evidence[];
  }>;
}
export function buildRemixTimeline(
  input: AssemblyInput,
  config: AssemblyConfig,
  edits?: CutEdit[],
): AssemblyData {
  const items: AssemblyItem[] = [],
    segments: AssemblySegment[] = [],
    issues: string[] = [],
    warnings: string[] = [];
  let cursor = 0;
  const order = edits
    ? [...new Set(edits.map((e) => e.segmentId))]
    : input.segments.map((s) => s.id);
  for (const s of input.segments) if (!order.includes(s.id)) order.push(s.id);
  if (edits) {
    const seen = new Set<string>();
    let last = '';
    for (const e of edits) {
      if (!input.segments.some((s) => s.id === e.segmentId))
        throw new BadRequestException(
          'Segmento da timeline não pertence ao roteiro.',
        );
      if (e.segmentId !== last && seen.has(e.segmentId))
        throw new BadRequestException(
          'Mantenha juntos os cortes de cada segmento narrativo.',
        );
      last = e.segmentId;
      seen.add(last);
    }
  }
  for (const segmentId of order) {
    const s = input.segments.find((s) => s.id === segmentId)!;
    const target =
      Math.ceil((s.audioDuration - 1e-6) * config.fps) / config.fps;
    const cuts: CutEdit[] = [];
    if (edits) cuts.push(...edits.filter((e) => e.segmentId === s.id));
    else {
      // Merge repeated/overlapping ranges from the same file; never add an unrelated source.
      const refs = s.refs.filter(
        (r, i, a) =>
          !a
            .slice(0, i)
            .some(
              (p) =>
                p.fileId === r.fileId && p.start <= r.start && p.end >= r.end,
            ),
      );
      let remaining = target;
      const available = refs.reduce((n, r) => n + r.end - r.start, 0),
        speed =
          config.allowSlowdown && available < target
            ? Math.max(0.9, Math.min(1, available / target))
            : 1;
      const used = new Map<string, number>();
      for (const ref of refs) {
        const start = Math.max(ref.start, used.get(ref.fileId) ?? 0);
        if (ref.end <= start || remaining <= 1e-5) continue;
        const sourceSeconds = Math.min(ref.end - start, remaining * speed);
        const end = start + sourceSeconds;
        cuts.push({
          id: randomUUID(),
          segmentId: s.id,
          candidateId: ref.id,
          sourceStart: start,
          sourceEnd: end,
          speed,
          freeze: 0,
          framing: config.framing,
          transition: 'CUT',
          transitionSeconds: 0.2,
          zoom: false,
        });
        used.set(ref.fileId, end);
        remaining -= sourceSeconds / speed;
      }
      if (
        remaining > 1 / config.fps + 1e-5 &&
        cuts.length &&
        remaining <= config.maxFreezeSeconds
      )
        cuts.at(-1)!.freeze = remaining;
    }
    let usedTime = 0;
    const first = cursor;
    for (const [index, cut] of cuts.entries()) {
      const ref = s.refs.find((r) => r.id === cut.candidateId);
      if (
        !ref ||
        cut.sourceStart < ref.start - 1e-5 ||
        cut.sourceEnd > ref.end + 1e-5 ||
        cut.sourceEnd <= cut.sourceStart
      )
        throw new BadRequestException(
          'Corte fora do intervalo selecionado e autorizado.',
        );
      if (
        cut.freeze > config.maxFreezeSeconds + 1e-6 ||
        (cut.speed < 1 && !config.allowSlowdown)
      )
        throw new BadRequestException(
          'Ative o ajuste limitado de velocidade/congelamento antes de utilizá-lo.',
        );
      const base = (cut.sourceEnd - cut.sourceStart) / cut.speed + cut.freeze;
      const wanted = Math.min(base, target - usedTime);
      if (wanted <= 0)
        throw new BadRequestException(
          'Há cortes excedentes após o fim da narração.',
        );
      if (base - wanted > 1 / config.fps + 0.001)
        throw new BadRequestException(
          'Reduza os cortes: excedem a duração do segmento narrativo.',
        );
      let duration = Math.floor((wanted + 1e-6) * config.fps) / config.fps;
      const last = index === cuts.length - 1;
      if (last && target - usedTime - duration <= 1 / config.fps + 1e-5)
        duration = target - usedTime;
      const padding = Math.max(0, duration - base);
      if (duration <= 0.001)
        throw new BadRequestException('Corte curto demais.');
      const normalizedEnd =
        cut.sourceStart +
        Math.min(
          cut.sourceEnd - cut.sourceStart,
          Math.max(0, duration - cut.freeze) * cut.speed,
        );
      items.push({
        ...cut,
        sourceEnd: normalizedEnd,
        sourceId: ref.sourceId,
        fileId: ref.fileId,
        audioId: s.audioId,
        order: items.length,
        duration,
        timelineStart: cursor,
        timelineEnd: cursor + duration,
        roundingPadding: padding,
        transitionIntervals:
          cut.transition === 'CUT'
            ? []
            : cut.transition === 'FADE'
              ? [
                  { start: cursor, end: cursor + cut.transitionSeconds },
                  {
                    start: cursor + duration - cut.transitionSeconds,
                    end: cursor + duration,
                  },
                ]
              : [
                  {
                    start: cursor + duration - cut.transitionSeconds,
                    end: cursor + duration,
                  },
                ],
      });
      cursor += duration;
      usedTime += duration;
      if (cut.transition !== 'CUT' && cut.transitionSeconds > duration / 2)
        issues.push(
          `Corte ${items.length}: transição longa demais para o trecho.`,
        );
    }
    if (target - usedTime > 1 / config.fps + 0.001)
      issues.push(
        `Segmento ${segments.length + 1}: faltam ${(target - usedTime).toFixed(2)}s de vídeo. Associe mais trechos relacionados, reduza a narração ou habilite ajuste limitado.`,
      );
    // Audio blocks retain their full duration even if visuals are insufficient; renders stay blocked.
    cursor = first + target;
    segments.push({
      id: s.id,
      text: s.text,
      audioId: s.audioId,
      audioKey: s.audioKey,
      audioFormat: s.audioFormat,
      audioBytes: s.audioBytes,
      audioDuration: s.audioDuration,
      duration: target,
      timelineStart: first,
      timelineEnd: cursor,
    });
  }
  if (Math.abs(cursor - input.targetDuration) > 0.2)
    warnings.push(
      `A timeline tem ${cursor.toFixed(2)}s; o alvo do roteiro é ${input.targetDuration}s. A duração acompanha a narração, sem preenchimento aleatório.`,
    );
  if (items.some((i) => i.framing.mode !== 'BLURRED_BACKGROUND'))
    warnings.push(
      'Revise o recorte no player: não há rastreamento automático de personagens ou objetos.',
    );
  if (items.at(-1)?.transition === 'CROSSFADE')
    warnings.push(
      'O último corte não tem próximo trecho; seu crossfade será ignorado.',
    );
  if (items.some((i) => i.freeze > 0))
    warnings.push('Há congelamento breve de frame explicitamente configurado.');
  return {
    scriptId: input.scriptId,
    scriptVersion: input.scriptVersion,
    scriptRevision: input.scriptRevision,
    contextHash: input.contextHash,
    config,
    items,
    segments,
    duration: cursor,
    issues,
    warnings,
    subtitleOverrides: null,
  };
}
