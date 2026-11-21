import { PlanningValidationError } from './planning-diagnostics';
import { isDeepStrictEqual } from 'node:util';
import {
  planningResponseSchema,
  planningLimits,
  type PlanningResponse,
  type PlanningDiagnostic,
} from './planning.schema';
import { assertJsonBudget, type PlanningContext } from './planning-context';
import { validateVisualTimeline, type PlannedSpan } from './planning-temporal';
import { validateResourceUsage } from '../resources/editing-resource.validator';
import { getResourceDefinition } from '../resources/editing-resource.registry';
import { isGraphicsId } from '../resources/graphics/graphics.schema';
import { isAudioId } from '../resources/audio/audio.schema';
import { compileAudioComposition } from '../resources/audio/audio-compiler';
import type { ValidatedResourceUsage } from '../resources/editing-resource.types';

export function validatePlanningResponse(
  raw: unknown,
  context: PlanningContext,
) {
  const diagnostics: PlanningDiagnostic[] = [];
  const add = (
    level: PlanningDiagnostic['level'],
    code: string,
    message: string,
    reference?: string,
  ) =>
    diagnostics.push({
      level,
      code,
      message,
      ...(reference ? { reference } : {}),
    });
  assertJsonBudget(raw, planningLimits.responseBytes);
  const plan = planningResponseSchema.parse(raw);
  if (plan.planningId !== context.input.planningId)
    throw new PlanningValidationError(
      'PLAN_INCOMPATIBLE',
      'Identificador de planejamento incompatível.',
    );
  if (
    Math.abs(plan.durationSeconds - context.input.target.durationSeconds) >
    1 / 60
  )
    throw new PlanningValidationError(
      'DURATION_INVALID',
      'Duração solicitada alterada sem autorização.',
    );
  if (context.knowledge.knowledgeStatus !== 'COMPLETE')
    add(
      'WARNING',
      'KNOWLEDGE_COVERAGE',
      `Cobertura editorial ${context.knowledge.knowledgeStatus}; perfis ausentes não foram inferidos.`,
    );
  if (!context.input.observations.length) {
    add(
      'WARNING',
      'NO_SEMANTIC_OBSERVATIONS',
      'Materiais sem observações semânticas: metadados não demonstram acontecimentos.',
    );
    if (plan.intent !== 'TECHNICAL_ONLY')
      add(
        'ERROR',
        'SEMANTIC_CONTEXT_REQUIRED',
        'Sem observações, somente planejamento técnico conservador é permitido.',
      );
  }
  const operations = [
    ...plan.visualOperations,
    ...plan.graphicOperations,
    ...plan.audioOperations,
  ];
  const opIds = new Set<string>();
  for (const group of [
    plan.visualOperations,
    plan.graphicOperations,
    plan.audioOperations,
  ])
    for (const operation of group) {
      if (opIds.has(operation.id))
        throw new PlanningValidationError(
          'DUPLICATE_REFERENCE',
          'Identificador de operação duplicado.',
        );
      opIds.add(operation.id);
      const u = validateResourceUsage(operation.usage, context.capabilities);
      const category = getResourceDefinition(u.resourceId).category;
      if (
        (group === plan.graphicOperations) !==
          (category === 'TEXT_AND_GRAPHICS') ||
        (group === plan.audioOperations) !== (category === 'AUDIO')
      )
        throw new PlanningValidationError(
          'TEMPORAL_INVALID',
          'Recurso na timeline incorreta.',
        );
      operation.usage = u;
      if (
        operation.observationIds.some(
          (id) => !context.input.observations.some((o) => o.id === id),
        )
      )
        throw new PlanningValidationError(
          'REFERENCE_INVALID',
          'Referência de observação inexistente.',
        );
      if (
        operation.timedTextId &&
        !context.input.timedText.some((t) => t.id === operation.timedTextId)
      )
        throw new PlanningValidationError(
          'REFERENCE_INVALID',
          'Referência de texto temporizado inexistente.',
        );
    }
  if (plan.visualOperations.length + plan.graphicOperations.length > 12)
    throw new PlanningValidationError(
      'PLAN_INCOMPATIBLE',
      'A composição visual e gráfica local admite até 12 operações combinadas.',
    );
  const imageIds = plan.graphicOperations.flatMap((o) =>
    typeof o.usage.parameters.assetId === 'string'
      ? [o.usage.parameters.assetId]
      : [],
  );
  if (
    new Set([...plan.clips.map((c) => c.clipId), ...imageIds]).size > 8 ||
    plan.clips.some((c) => imageIds.includes(c.clipId))
  )
    throw new PlanningValidationError(
      'SOURCE_LIMIT_EXCEEDED',
      'A composição visual e gráfica admite até oito origens, com identificadores não ambíguos.',
    );
  const visual = validateVisualTimeline(plan, context);
  if (plan.durationSeconds !== visual.duration) {
    add(
      'INFO',
      'FRAME_ROUNDING',
      'Duração normalizada ao frame mais próximo no relógio de 30 FPS.',
    );
    plan.durationSeconds = visual.duration;
  }
  validateGraphics(plan, context, visual.outputClipId, add);
  const audio = validateAudio(plan, context, visual.spans);
  validateEvents(plan, context, visual.spans);
  validateEditorial(plan, context, visual.spans, add);
  add(
    'INFO',
    'DURATION_STRATEGY',
    'Duração determinada pelo alvo explícito e validada contra a composição visual; TTS não é o relógio mestre.',
  );
  add(
    'WARNING',
    'EXECUTION_PREFLIGHT_REQUIRED',
    'Validação baseada em metadados autorizados. Layout rasterizado, integridade dos arquivos e codecs reais exigem preflight na etapa de execução.',
  );
  return {
    contractVersion: 1 as const,
    plan,
    contextSnapshot: context.input,
    knowledgeStatus: context.knowledge.knowledgeStatus,
    knowledgeVersion: context.knowledge.knowledgeVersion,
    pacing: {
      requested: context.input.editorialPreferences.cutRhythm,
      spans: visual.spans.length,
      averageSpanSeconds:
        visual.spans.reduce((n, s) => n + s.duration, 0) / visual.spans.length,
    },
    diagnostics,
    visual,
    audio,
  };
}
type Add = (
  level: PlanningDiagnostic['level'],
  code: string,
  message: string,
  reference?: string,
) => void;
function validateAudio(
  plan: PlanningResponse,
  ctx: PlanningContext,
  spans: PlannedSpan[],
) {
  const usedSourceIds = new Set(
    plan.audioOperations.flatMap((o) =>
      typeof o.usage.parameters.sourceId === 'string'
        ? [o.usage.parameters.sourceId]
        : [],
    ),
  );
  const sources = [
    ...ctx.input.audios.map((a) => a.metadata),
    ...ctx.input.videos.flatMap((v) => (v.audio ? [v.audio] : [])),
  ].filter((s) => usedSourceIds.has(s.id));
  const originalTracks = new Set(
    plan.audioOperations
      .filter((o) => o.usage.resourceId === 'ORIGINAL_AUDIO')
      .map((o) =>
        o.usage.target.scope === 'COMPOSITION'
          ? o.usage.target.clipId
          : undefined,
      ),
  );
  for (const op of plan.audioOperations) {
    const u = op.usage as ValidatedResourceUsage;
    if (
      u.resourceId === 'AUDIO_LOOP' &&
      u.target.scope === 'COMPOSITION' &&
      originalTracks.has(u.target.clipId)
    )
      throw new PlanningValidationError(
        'AUDIO_SYNC_INVALID',
        'Loop posterior à sincronização do áudio original exige replanejamento explícito dos clipes.',
      );
    if (!isAudioId(u.resourceId))
      throw new PlanningValidationError(
        'PLAN_INCOMPATIBLE',
        'Recurso sonoro inválido.',
      );
    if ('sourceId' in u.parameters) {
      const p = u.parameters as {
        sourceId: string;
        sourceStart: number;
        sourceEnd: number;
        timelineStart: number;
        timelineEnd?: number;
        rate: number;
        repeat: number;
        freeze?: string;
        endBehavior: string;
        clipId: string;
      };
      const source = ctx.input.audios.find((a) => a.metadata.id === p.sourceId);
      const video = ctx.input.videos.find((v) => v.metadata.id === p.sourceId);
      const allowed = source?.usableIntervals ?? video?.usableIntervals;
      if (
        !allowed?.some(
          (i) =>
            p.sourceStart >= i.start &&
            (p.freeze === 'CONTINUE_SOURCE'
              ? p.sourceStart + (p.timelineEnd! - p.timelineStart)
              : p.sourceEnd) <= i.end,
        )
      )
        throw new PlanningValidationError(
          'SOURCE_UNAUTHORIZED',
          'Áudio fora de fonte ou intervalo autorizado.',
        );
      if (
        u.resourceId === 'NARRATION' &&
        (ctx.input.narration.mode === 'WITHOUT_NARRATION' ||
          source?.role !== 'NARRATION')
      )
        throw new PlanningValidationError(
          'NARRATION_INVALID',
          'Narração proibida ou fonte de voz incompatível.',
        );
      if (
        u.resourceId === 'BACKGROUND_MUSIC' &&
        !['MUSIC', 'AMBIENCE'].includes(source?.role ?? '')
      )
        throw new PlanningValidationError(
          'SOURCE_UNAUTHORIZED',
          'Fonte não autorizada para música/ambiente.',
        );
      if (u.resourceId === 'SOUND_EFFECT' && source?.role !== 'EFFECT')
        throw new PlanningValidationError(
          'SOURCE_UNAUTHORIZED',
          'Fonte não autorizada para efeito sonoro.',
        );
      if (u.resourceId === 'ORIGINAL_AUDIO') {
        if (!video?.hasAudio)
          throw new PlanningValidationError(
            'SOURCE_INVALID',
            'Fonte sem stream de áudio original.',
          );
        const matches = spans.filter(
          (s) =>
            s.sourceId === p.sourceId &&
            Math.abs(s.timelineStart - p.timelineStart) <= 1 / 48000 &&
            Math.abs(s.sourceStart - p.sourceStart) <= 1 / 30,
        );
        const span = matches.find((s) =>
          s.kind === 'FREEZE'
            ? p.freeze === 'SILENCE' || p.freeze === 'CONTINUE_SOURCE'
            : Math.abs(s.sourceEnd - p.sourceEnd) <= 1 / 30 &&
              Math.abs((s.sourceEnd - s.sourceStart) / s.duration - p.rate) <
                1e-5 &&
              p.repeat === 1 &&
              p.freeze === 'NONE',
        );
        if (
          !span ||
          Math.abs(
            (p.timelineEnd ??
              p.timelineStart + (p.sourceEnd - p.sourceStart) / p.rate) -
              p.timelineStart -
              span.duration,
          ) >
            1 / 30
        )
          throw new PlanningValidationError(
            'PLAN_INCOMPATIBLE',
            'Áudio original sem correspondência temporal explícita com o vídeo processado.',
          );
        if (p.endBehavior === 'LOOP')
          throw new PlanningValidationError(
            'PLAN_INCOMPATIBLE',
            'Áudio original sincronizado não admite loop independente.',
          );
      }
    }
  }
  if (
    ctx.input.narration.mode === 'WITH_NARRATION' &&
    !plan.audioOperations.some((o) => o.usage.resourceId === 'NARRATION')
  )
    throw new PlanningValidationError(
      'NARRATION_INVALID',
      'Modo com narração exige voz existente e autorizada.',
    );
  const result = compileAudioComposition(
    {
      contractVersion: 1,
      duration: plan.durationSeconds,
      operations: plan.audioOperations.map((o) => o.usage),
      silentOutput: 'SILENT_TRACK',
    },
    sources,
  );
  return {
    duration: result.duration,
    sampleRate: 48000 as const,
    channels: 2 as const,
    tracks: result.tracks,
    impacts: result.impacts,
    silent: plan.audioOperations.length === 0,
  };
}
function validateGraphics(
  plan: PlanningResponse,
  ctx: PlanningContext,
  outputId: string,
  add: Add,
) {
  const windows: Array<{ start: number; end: number }> = [];
  const panels = new Map<
    string,
    {
      items: Array<{ position: number; label: string }>;
      start: number;
      end: number;
      revealed: boolean;
    }
  >();
  let animations = 0,
    characters = 0,
    cues = 0;
  for (const operation of plan.graphicOperations) {
    const u = operation.usage as ValidatedResourceUsage;
    if (!isGraphicsId(u.resourceId))
      throw new PlanningValidationError(
        'GRAPHICS_INVALID',
        'Recurso gráfico inválido.',
      );
    if (u.target.scope !== 'COMPOSITION' || u.target.clipId !== outputId)
      throw new PlanningValidationError(
        'GRAPHICS_INVALID',
        'Gráfico deve referenciar a composição final.',
      );
    const p = u.parameters as Record<string, any>;
    const authorizedTexts = [
      ...ctx.input.displayTexts.map((t) => t.text),
      ...Object.values(ctx.input.script ?? {}),
      ...ctx.input.observations.map((o) => o.description),
      ...(ctx.input.ranking ? [ctx.input.ranking.criterion] : []),
    ];
    const staticText =
      typeof p.text === 'string'
        ? p.text
        : p.segments
          ? p.segments.map((r: { text: string }) => r.text).join('')
          : u.resourceId === 'WORD_HIGHLIGHT' && p.mode === 'STATIC'
            ? p.words.map((w: { text: string }) => w.text).join(' ')
            : undefined;
    if (staticText !== undefined && !authorizedTexts.includes(staticText))
      throw new PlanningValidationError(
        'TEXT_EVIDENCE_INVALID',
        'Texto gráfico sem conteúdo previamente fornecido; não é permitido inventar afirmações.',
      );
    const start = p.start ?? 0,
      end = p.end ?? plan.durationSeconds;
    const addElement = (a: number, b: number, count = 1) => {
      if (a < 0 || b > plan.durationSeconds + 1e-6 || b <= a)
        throw new PlanningValidationError(
          'GRAPHICS_INVALID',
          'Elemento gráfico fora da timeline.',
        );
      for (let i = 0; i < count; i++) windows.push({ start: a, end: b });
    };
    if (p.animations) {
      if (
        p.animations.filter((a: any) =>
          ['SCALE_IN', 'SCALE_OUT', 'POP', 'PULSE'].includes(a.type),
        ).length > 1
      )
        throw new PlanningValidationError(
          'ANIMATION_INVALID',
          'Animações de escala incompatíveis.',
        );
      for (const a of p.animations)
        if (a.at + a.duration * a.repetitions > end - start + 1e-6)
          throw new PlanningValidationError(
            'ANIMATION_INVALID',
            'Animação além do elemento.',
          );
      animations += p.animations.length;
    }
    if (p.assetId && !ctx.input.images.some((i) => i.id === p.assetId))
      throw new PlanningValidationError(
        'SOURCE_UNAUTHORIZED',
        'Imagem não autorizada ou inexistente.',
      );
    if (
      u.resourceId === 'CAPTIONS' ||
      (u.resourceId === 'WORD_HIGHLIGHT' && p.mode === 'SYNC')
    ) {
      const tokens = u.resourceId === 'CAPTIONS' ? p.captions : p.words;
      const evidence = ctx.input.timedText.find(
        (t) =>
          t.id === operation.timedTextId &&
          t.kind === (u.resourceId === 'CAPTIONS' ? 'CAPTION' : 'WORD'),
      );
      if (!evidence)
        throw new PlanningValidationError(
          'TIMED_TEXT_INVALID',
          'Legenda/destaque sem timestamps fornecidos.',
        );
      const voice = plan.audioOperations.find(
        (o) =>
          o.usage.resourceId === 'NARRATION' &&
          (o.usage.parameters as any).sourceId === evidence.sourceId,
      );
      const vp = voice?.usage.parameters as any;
      if (!vp || vp.rate !== 1 || vp.repeat !== 1 || vp.endBehavior !== 'STOP')
        throw new PlanningValidationError(
          'TEXT_EVIDENCE_INVALID',
          'Texto sincronizado exige narração com relógio simples explícito.',
        );
      const expected = evidence.tokens.map((w) => ({
        ...w,
        start: w.start - vp.sourceStart + vp.timelineStart,
        end: w.end - vp.sourceStart + vp.timelineStart,
      }));
      if (
        !isDeepStrictEqual(
          tokens.map((w: any) => ({
            text: w.text,
            start: w.start,
            end: w.end,
          })),
          expected,
        )
      )
        throw new PlanningValidationError(
          'TIMED_TEXT_INVALID',
          'Timestamps ou palavras inventados/alterados.',
        );
      for (const w of tokens) {
        if (w.start < start || w.end > end)
          throw new PlanningValidationError(
            'TEXT_EVIDENCE_INVALID',
            'Texto temporizado fora do elemento.',
          );
        addElement(w.start, w.end);
        characters += w.text.length;
      }
      if (u.resourceId === 'CAPTIONS') {
        cues += tokens.length;
        animations += (tokens.length - 1) * (p.animations?.length ?? 0);
      } else {
        const gaps = [
          [start, tokens[0].start],
          ...tokens
            .slice(1)
            .map((w: any, i: number) => [tokens[i].end, w.start]),
          [tokens[tokens.length - 1].end, end],
        ];
        let phases = tokens.length;
        for (const [a, b] of gaps)
          if (b > a) {
            addElement(a, b);
            phases++;
          }
        characters +=
          (phases - 1) *
          tokens.reduce((n: number, w: any) => n + w.text.length + 1, 0);
        animations += (phases - 1) * (p.animations?.length ?? 0);
      }
    } else if (u.resourceId === 'RANKING_PANEL') {
      if (!ctx.input.ranking || panels.has(p.panelId))
        throw new PlanningValidationError(
          'DUPLICATE_REFERENCE',
          'Painel sem ranking comprovado ou duplicado.',
        );
      if (
        p.items.length !== ctx.input.ranking.items.length ||
        p.items.some(
          (item: any) =>
            !ctx.input.ranking!.items.some(
              (i) => i.position === item.position && i.label === item.label,
            ),
        )
      )
        throw new PlanningValidationError(
          'RANKING_INVALID',
          'Ranking inventado ou posição inexistente.',
        );
      panels.set(p.panelId, { items: p.items, start, end, revealed: false });
      const reveal = plan.graphicOperations.find(
        (o) =>
          o.usage.resourceId === 'RANKING_REVEAL' &&
          o.usage.parameters.panelId === p.panelId,
      )?.usage.parameters as any;
      let phases = 0;
      for (const item of p.items) {
        const begin =
          reveal?.reveals.find((r: any) => r.position === item.position)
            ?.revealAt ?? (reveal ? end : start);
        const activeEnd = Math.min(
          end,
          begin + (reveal?.highlightDuration ?? 0),
        );
        const states = [
          [start, begin],
          [begin, activeEnd],
          [activeEnd, end],
        ];
        for (const [a, b] of states)
          if (b > a) {
            addElement(a, b);
            phases++;
          }
      }
      animations += (phases - 1) * (p.animations?.length ?? 0);
    } else if (u.resourceId === 'RANKING_REVEAL') {
      const panel = panels.get(p.panelId);
      if (!panel || panel.revealed)
        throw new PlanningValidationError(
          'DUPLICATE_REFERENCE',
          'Revelação sem painel anterior ou duplicada.',
        );
      panel.revealed = true;
      if (p.reveals.length !== panel.items.length)
        throw new PlanningValidationError(
          'RANKING_INVALID',
          'Ranking não revela todas as posições.',
        );
      for (const r of p.reveals)
        if (
          !panel.items.some((i) => i.position === r.position) ||
          r.revealAt < panel.start ||
          r.revealAt >= panel.end ||
          r.revealAt + p.highlightDuration > panel.end
        )
          throw new PlanningValidationError(
            'RANKING_INVALID',
            'Revelação fora do painel ou posição inexistente.',
          );
    } else {
      let count = 1;
      const writer = p.animations?.find((a: any) => a.type === 'TYPEWRITER');
      if (writer) {
        const content = p.text ?? '';
        count = [
          ...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(
            content,
          ),
        ].length;
        if (
          !content ||
          p.animations.length !== 1 ||
          writer.repetitions !== 1 ||
          count > 80 ||
          writer.duration / count < 1 / 30
        )
          throw new PlanningValidationError(
            'PLAN_INCOMPATIBLE',
            'TYPEWRITER incompatível.',
          );
      }
      if (writer) {
        for (let i = 0; i < count; i++)
          addElement(
            start + writer.at + (i * writer.duration) / count,
            i === count - 1
              ? end
              : start + writer.at + ((i + 1) * writer.duration) / count,
          );
      } else addElement(start, end);
    }
    characters +=
      (p.text?.length ?? 0) +
      (p.segments?.reduce((n: number, r: any) => n + r.text.length, 0) ?? 0) +
      (p.items?.reduce((n: number, r: any) => n + r.label.length, 0) ?? 0);
  }
  if (
    windows.length > 160 ||
    animations > 64 ||
    characters > 20000 ||
    cues > 120
  )
    throw new PlanningValidationError(
      'LIMIT_EXCEEDED',
      'Limites globais de gráficos excedidos.',
    );
  const events = windows
    .flatMap((w) => [
      { at: w.start, n: 1 },
      { at: w.end, n: -1 },
    ])
    .sort((a, b) => a.at - b.at || a.n - b.n);
  let concurrent = 0;
  for (const e of events) {
    concurrent += e.n;
    if (concurrent > 32)
      throw new PlanningValidationError(
        'PLAN_INCOMPATIBLE',
        'Mais de 32 elementos simultâneos.',
      );
  }
  if (plan.graphicOperations.length)
    add(
      'WARNING',
      'GRAPHIC_LAYOUT_PREFLIGHT',
      'Fontes e parâmetros validados; medidas finais, glyphs e limites de pixels exigem rasterização futura.',
    );
}
function validateEvents(
  plan: PlanningResponse,
  ctx: PlanningContext,
  spans: PlannedSpan[],
) {
  const ids = new Set<string>(),
    ops = [
      ...plan.visualOperations,
      ...plan.graphicOperations,
      ...plan.audioOperations,
    ];
  for (const event of plan.events) {
    if (
      ids.has(event.id) ||
      event.at >= plan.durationSeconds ||
      event.operationIds.some((id) => !ops.some((o) => o.id === id))
    )
      throw new PlanningValidationError(
        'REFERENCE_INVALID',
        'Evento duplicado, fora da timeline ou com referência inexistente.',
      );
    ids.add(event.id);
    if (event.kind === 'OBSERVED') {
      const observation = ctx.input.observations.find(
        (o) => o.id === event.observationId,
      );
      const visible =
        observation &&
        spans.some(
          (s) =>
            s.kind === 'PLAY' &&
            s.sourceId === observation.sourceId &&
            event.at >= s.timelineStart &&
            event.at < s.timelineStart + s.duration &&
            (() => {
              const at =
                s.sourceStart +
                ((event.at - s.timelineStart) * (s.sourceEnd - s.sourceStart)) /
                  s.duration;
              return (
                at >= observation.interval.start &&
                at < observation.interval.end
              );
            })(),
        );
      if (!visible)
        throw new PlanningValidationError(
          'SOURCE_INVALID',
          'Evento sem correspondência com observação na fonte.',
        );
    } else if (event.observationId)
      throw new PlanningValidationError(
        'PLAN_INCOMPATIBLE',
        'Evidência sem evento observado.',
      );
    if (
      event.kind === 'RANKING_REVEAL' &&
      !plan.graphicOperations.some(
        (o) =>
          o.usage.resourceId === 'RANKING_REVEAL' &&
          (o.usage.parameters as any).reveals.some(
            (r: any) =>
              r.position === event.position && r.revealAt === event.at,
          ),
      )
    )
      throw new PlanningValidationError(
        'RANKING_INVALID',
        'Evento não corresponde à revelação do ranking.',
      );
    for (const id of event.operationIds) {
      const op = ops.find((o) => o.id === id)!;
      const p = op.usage.parameters as any;
      if (
        op.usage.resourceId === 'SOUND_EFFECT' &&
        Math.abs(p.timelineStart - event.at) > 1 / 48000
      )
        throw new PlanningValidationError(
          'PLAN_INCOMPATIBLE',
          'Efeito sonoro dessincronizado do evento.',
        );
      if (
        isGraphicsId(op.usage.resourceId) &&
        op.usage.resourceId !== 'RANKING_REVEAL' &&
        Math.abs((p.start ?? 0) - event.at) > 1 / 30
      )
        throw new PlanningValidationError(
          'GRAPHICS_INVALID',
          'Gráfico dessincronizado do evento.',
        );
    }
  }
}
function validateEditorial(
  plan: PlanningResponse,
  ctx: PlanningContext,
  spans: PlannedSpan[],
  add: Add,
) {
  const ops = [
    ...plan.visualOperations,
    ...plan.graphicOperations,
    ...plan.audioOperations,
  ];
  const rules = ctx.knowledge.guidance;
  if (
    new Set(plan.ruleDecisions.map((d) => d.guidanceId)).size !==
    plan.ruleDecisions.length
  )
    throw new PlanningValidationError(
      'DUPLICATE_REFERENCE',
      'Decisão editorial duplicada.',
    );
  for (const d of plan.ruleDecisions)
    if (
      !rules.some((r) => r.id === d.guidanceId) ||
      d.operationIds.some((id) => !ops.some((o) => o.id === id))
    )
      throw new PlanningValidationError(
        'PLAN_INCOMPATIBLE',
        'Decisão editorial sem orientação/operação válida.',
      );
  for (const rule of rules) {
    const mapped = ctx.knowledgeMapping
      .find((m) => m.guidanceId === rule.id)!
      .resources.flatMap((m) => m.resources.map((r) => r.id));
    const used = ops.filter((o) => mapped.includes(o.usage.resourceId));
    const decision = plan.ruleDecisions.find((d) => d.guidanceId === rule.id);
    if (rule.level === 'FORBIDDEN' && used.length)
      add(
        'ERROR',
        'FORBIDDEN_RESOURCE',
        'Plano utiliza recurso proibido pela orientação.',
        rule.id,
      );
    if (
      ['REQUIRED', 'FORBIDDEN'].includes(rule.level) &&
      (!decision || decision.status !== 'SATISFIED')
    )
      add(
        'ERROR',
        'HARD_RULE_UNSATISFIED',
        'Restrição obrigatória/proibição exige atendimento explícito; revisão necessária.',
        rule.id,
      );
    if (rule.level === 'REQUIRED' && mapped.length && !used.length)
      add(
        'ERROR',
        'REQUIRED_RESOURCE_MISSING',
        'Nenhum recurso exigido disponível foi selecionado.',
        rule.id,
      );
    if (
      rule.level === 'REQUIRED' &&
      rule.target === 'ranking.criterion' &&
      ctx.input.ranking &&
      !plan.graphicOperations.some(
        (o) => o.usage.parameters.text === ctx.input.ranking!.criterion,
      )
    )
      add(
        'ERROR',
        'RANKING_CRITERION_NOT_PRESENTED',
        'O critério fornecido precisa ser apresentado explicitamente como texto no plano.',
        rule.id,
      );
    if (
      rule.level === 'REQUIRED' &&
      rule.target.startsWith('ranking.') &&
      !ctx.input.ranking
    )
      add(
        'ERROR',
        'RANKING_EVIDENCE_REQUIRED',
        'Ranking requer critério, itens e evidências fornecidos.',
        rule.id,
      );
    if (
      rule.level === 'REQUIRED' &&
      !mapped.length &&
      !rule.target.startsWith('ranking.')
    )
      add(
        'ERROR',
        'REQUIRED_RULE_REVIEW',
        'Obrigação sem verificador estrutural conhecido requer revisão; não foi presumida satisfeita.',
        rule.id,
      );
    if (rule.level === 'DISCOURAGED' && used.length && !decision)
      add(
        'WARNING',
        'DISCOURAGED_RESOURCE',
        'Recurso desaconselhado exige justificativa editorial.',
        rule.id,
      );
  }
  for (const conflict of ctx.knowledge.conflicts)
    add(
      conflict.status === 'UNRESOLVED' ? 'ERROR' : 'WARNING',
      'EDITORIAL_CONFLICT',
      conflict.reason,
      conflict.target,
    );
  for (const m of ctx.preferenceMapping) {
    const value =
      ctx.input.editorialPreferences.resources[
        m.preference as keyof typeof ctx.input.editorialPreferences.resources
      ];
    const used = ops.filter((o) =>
      m.resources.some((r) => r.id === o.usage.resourceId),
    );
    if (value === 'AVOID' && used.length)
      add(
        'WARNING',
        'AVOID_OVERRIDDEN',
        `Preferência AVOID contrariada: ${m.preference}. Justificativas registradas nas operações.`,
        used[0].id,
      );
    if (value === 'PREFER' && !used.length)
      add(
        'INFO',
        'PREFERENCE_NOT_SELECTED',
        `Preferência ${m.preference} não utilizada; PREFER não é obrigação.`,
      );
  }
  if (ctx.input.classification.videoType === 'TOP_X' && !ctx.input.ranking)
    add(
      'ERROR',
      'RANKING_EVIDENCE_REQUIRED',
      'Não é possível inventar ranking a partir de metadados.',
    );
  if (ctx.input.ranking) {
    const shown = plan.graphicOperations.some((o) =>
      ['RANKING_PANEL', 'RANKING_REVEAL'].includes(o.usage.resourceId),
    );
    if (ctx.input.classification.videoType === 'TOP_X' && !shown)
      add(
        'ERROR',
        'RANKING_PRESENTATION_REQUIRED',
        'Itens do ranking precisam ser representados no plano.',
      );
    for (const item of ctx.input.ranking.items)
      if (
        !item.observationIds.some((id) => {
          const ob = ctx.input.observations.find((o) => o.id === id)!;
          return spans.some(
            (s) =>
              s.sourceId === ob.sourceId &&
              s.sourceStart <= ob.interval.start &&
              s.sourceEnd >= ob.interval.end,
          );
        })
      )
        add(
          'ERROR',
          'RANKING_SOURCE_MISSING',
          'Ranking referencia acontecimento em fonte não selecionada.',
        );
  }
  if (
    plan.intent === 'TECHNICAL_ONLY' &&
    (plan.events.some((e) => e.kind !== 'TECHNICAL') ||
      plan.graphicOperations.some((o) =>
        ['RANKING_PANEL', 'RANKING_REVEAL'].includes(o.usage.resourceId),
      ))
  )
    add(
      'ERROR',
      'TECHNICAL_PLAN_SEMANTICS',
      'Plano conservador não pode afirmar eventos ou rankings.',
    );
}
