import { compileResourceComposition } from '../resources/editing-resource.compiler';
import { compileAudioComposition } from '../resources/audio/audio-compiler';
import { appendGraphicsGraph } from '../resources/graphics/graphics-animation';
import type { PreparedGraphic } from '../resources/graphics/graphics-renderer';
import type {
  PlanningInput,
  PlanningResponse,
} from '../planning/planning.schema';
import type { ResourceCapability } from '../resources/editing-resource.types';
export function compileExecutionVisual(
  plan: PlanningResponse,
  context: PlanningInput,
  capabilities: readonly ResourceCapability[],
) {
  return compileResourceComposition(
    {
      contractVersion: 1,
      operations: plan.visualOperations.map((o) => o.usage),
    },
    plan.clips.map((c) => ({
      ...context.videos.find((v) => v.metadata.id === c.sourceId)!.metadata,
      id: c.clipId,
    })),
    capabilities,
    { width: context.target.width, height: context.target.height, fps: 30 },
  );
}
export function compileExecutionGraph(
  visual: ReturnType<typeof compileExecutionVisual>,
  graphics: PreparedGraphic[],
  plan: PlanningResponse,
  context: PlanningInput,
) {
  const finalVisual = appendGraphicsGraph(visual, graphics);
  const used = new Set(
    plan.audioOperations.flatMap((o) =>
      typeof o.usage.parameters.sourceId === 'string'
        ? [o.usage.parameters.sourceId]
        : [],
    ),
  );
  const audio = plan.audioOperations.length
    ? compileAudioComposition(
        {
          contractVersion: 1,
          duration: plan.durationSeconds,
          operations: plan.audioOperations.map((o) => o.usage),
        },
        [
          ...context.audios.map((a) => a.metadata),
          ...context.videos.flatMap((v) => (v.audio ? [v.audio] : [])),
        ].filter((s) => used.has(s.id)),
      )
    : null;
  // Video aliases and audio sources refer to different ID namespaces. Bind original
  // audio to an existing video input when possible, without decoding it a second time.
  const additionalAudioIds: string[] = [],
    indices: number[] = [];
  for (const id of audio?.inputIds ?? []) {
    const aliasIndex = visual.inputIds.findIndex(
      (alias) => plan.clips.find((c) => c.clipId === alias)?.sourceId === id,
    );
    if (aliasIndex >= 0) indices.push(aliasIndex);
    else {
      indices.push(
        visual.inputIds.length + graphics.length + additionalAudioIds.length,
      );
      additionalAudioIds.push(id);
    }
  }
  const audioGraph = audio?.filterGraph
    .replace(/\[(\d+):a:0\]/g, (_, n: string) => `[${indices[Number(n)]}:a:0]`)
    .replace(/\[(a\d+)\]/g, '[exec_$1]');
  const filterGraph =
    finalVisual.filterGraph + (audioGraph ? ';' + audioGraph : '');
  if (filterGraph.length > 120000)
    throw Error('Complexidade do grafo audiovisual excedida.');
  return {
    filterGraph,
    videoLabel: finalVisual.outputLabel,
    audioLabel: audio ? `exec_${audio.outputLabel}` : null,
    additionalAudioIds,
    audio,
  };
}
