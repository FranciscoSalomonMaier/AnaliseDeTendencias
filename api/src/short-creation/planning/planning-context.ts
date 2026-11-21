import { PlanningValidationError } from './planning-diagnostics';
import { z } from 'zod';
import {
  contextInputSchema,
  planningLimits,
  type PlanningInput,
} from './planning.schema';
import { resolveEditorialKnowledge } from '../knowledge/editorial-knowledge.resolver';
import { editingResourceRegistry } from '../resources/editing-resource.registry';
import {
  knowledgeResourceCorrespondence,
  preferenceResourceCorrespondence,
} from '../resources/editing-resource.mapping';
import type { ResourceCapability } from '../resources/editing-resource.types';

export function assertJsonBudget(value: unknown, bytes: number) {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > bytes)
    throw new PlanningValidationError(
      'LIMIT_EXCEEDED',
      'Limite de tamanho do JSON excedido.',
    );
  return json;
}
/** The caller must obtain these grants and capabilities from trusted server resolvers,
 * never from model output or an unauthenticated request. No paths are accepted here. */
export interface PlanningAuthority {
  authorizedAssetIds: ReadonlySet<string>;
  capabilities: readonly ResourceCapability[];
}
export function buildPlanningContext(
  raw: unknown,
  authority: PlanningAuthority,
) {
  assertJsonBudget(raw, planningLimits.contextBytes);
  const input = contextInputSchema.parse(raw);
  const assets = [
    ...input.videos.map((v) => v.metadata.id),
    ...input.audios.map((a) => a.metadata.id),
    ...input.images.map((i) => i.id),
  ];
  if (new Set(assets).size !== assets.length)
    throw new PlanningValidationError(
      'DUPLICATE_REFERENCE',
      'Identificadores de fontes duplicados.',
    );
  for (const id of assets)
    if (!authority.authorizedAssetIds.has(id))
      throw Error(`Fonte não autorizada: ${id}.`);
  const observations = new Set<string>();
  for (const o of input.observations) {
    const video = input.videos.find((v) => v.metadata.id === o.sourceId);
    if (
      observations.has(o.id) ||
      !video ||
      !video.usableIntervals.some(
        (i) => o.interval.start >= i.start && o.interval.end <= i.end,
      )
    )
      throw new PlanningValidationError(
        'SOURCE_UNAUTHORIZED',
        'Observação sem fonte ou intervalo autorizado.',
      );
    observations.add(o.id);
  }
  for (const v of input.videos) {
    if (
      v.hasAudio !== !!v.audio ||
      (v.audio &&
        (v.audio.kind !== 'VIDEO' ||
          v.audio.id !== v.metadata.id ||
          Math.abs(v.audio.duration - v.metadata.duration) > 1 / 30))
    )
      throw new PlanningValidationError(
        'PLAN_INCOMPATIBLE',
        'Metadados de áudio/vídeo incompatíveis.',
      );
    intervals(v.usableIntervals, v.metadata.duration);
  }
  for (const a of input.audios) {
    if (a.metadata.kind !== 'AUDIO')
      throw new PlanningValidationError(
        'SOURCE_INVALID',
        'Fonte sonora deve ser AUDIO.',
      );
    intervals(a.usableIntervals, a.metadata.duration);
  }
  const timedIds = new Set<string>();
  for (const t of input.timedText) {
    const source = input.audios.find((a) => a.metadata.id === t.sourceId);
    if (
      !source ||
      timedIds.has(t.id) ||
      t.tokens.some(
        (w, i) =>
          w.end > source.metadata.duration ||
          (i > 0 && w.start < t.tokens[i - 1].end),
      )
    )
      throw new PlanningValidationError(
        'TEXT_EVIDENCE_INVALID',
        'Timestamps de texto sem fonte válida ou ordenação.',
      );
    timedIds.add(t.id);
  }
  if (input.ranking) {
    const positions = new Set<number>();
    for (const item of input.ranking.items) {
      if (
        positions.has(item.position) ||
        item.observationIds.some((id) => !observations.has(id))
      )
        throw new PlanningValidationError(
          'DUPLICATE_REFERENCE',
          'Ranking sem evidências ou com posições duplicadas.',
        );
      positions.add(item.position);
    }
  }
  const capabilities = editingResourceRegistry.map((def) => {
    const c = authority.capabilities.find(
      (c) => c.id === def.id && c.version === def.version,
    );
    if (!c)
      throw new PlanningValidationError(
        'PLAN_INCOMPATIBLE',
        'Snapshot de capacidades incompleto.',
      );
    return { ...c };
  });
  const knowledge = resolveEditorialKnowledge(input.classification);
  const catalog = editingResourceRegistry.map((def) => ({
    id: def.id,
    version: def.version,
    description: def.description,
    category: def.category,
    scopes: def.scopes,
    changesDuration: def.changesDuration,
    requiredFilters: def.requiredFilters,
    restrictions: def.restrictions,
    available: capabilities.find((c) => c.id === def.id)!.available,
    parameters: def.parametersSchema
      ? z.toJSONSchema(def.parametersSchema, { io: 'input' })
      : null,
  }));
  const context = {
    input,
    knowledge,
    capabilities,
    catalog,
    knowledgeMapping: knowledgeResourceCorrespondence(knowledge, capabilities),
    preferenceMapping: preferenceResourceCorrespondence(capabilities),
  };
  assertJsonBudget(context, planningLimits.promptBytes);
  return context;
}
function intervals(
  values: PlanningInput['videos'][number]['usableIntervals'],
  duration: number,
) {
  for (const [i, v] of values.entries())
    if (v.end > duration || (i > 0 && v.start < values[i - 1].end))
      throw new PlanningValidationError(
        'TEMPORAL_INVALID',
        'Intervalos utilizáveis inválidos ou sobrepostos.',
      );
}
export type PlanningContext = ReturnType<typeof buildPlanningContext>;
