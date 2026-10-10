import { Injectable } from '@nestjs/common';
import type { ContentProject } from '../content-projects/content-project.schema';
import type {
  ContentAsset,
  VisualSelection,
} from '../content-assets/content-asset';
import type { AudioSelection } from '../content-narration/narration.repository';
import {
  TtsSettings,
  narrationFingerprint,
  narrationTextHash,
} from '../content-narration/tts-settings';
import { sceneVisualFingerprint } from '../content-assets/scene-image-prompt.builder';
import { RenderSettings } from './render-settings';
import type { MotionPreset, RenderSnapshot, TimelineScene } from './render-job';
export interface RenderIssue {
  sceneId: string | null;
  order: number | null;
  message: string;
}
@Injectable()
export class TimelineBuilder {
  constructor(
    private readonly settings: RenderSettings,
    private readonly tts: TtsSettings,
  ) {}
  build(
    p: ContentProject,
    assets: ContentAsset[],
    visuals: VisualSelection[],
    audio: AudioSelection[],
  ) {
    const issues: RenderIssue[] = [];
    if (p.config.type !== 'VIDEO')
      issues.push({
        sceneId: null,
        order: null,
        message: 'O projeto deve ser do tipo VIDEO.',
      });
    if (p.status !== 'SCENES_APPROVED' || p.scriptStale || p.scenesStale)
      issues.push({
        sceneId: null,
        order: null,
        message: 'Aprove as cenas e o roteiro atuais antes de gerar vídeo.',
      });
    if (!p.scenes.length)
      issues.push({
        sceneId: null,
        order: null,
        message: 'O projeto não possui cenas.',
      });
    const scenes: TimelineScene[] = [],
      ordered = [...p.scenes].sort((a, b) => a.order - b.order),
      ids = new Set<string>();
    const presets: MotionPreset[] = [
      'SLOW_ZOOM_IN',
      'PAN_RIGHT',
      'SLOW_ZOOM_OUT',
      'PAN_LEFT',
    ];
    let frameOffset = 0;
    ordered.forEach((scene, i) => {
      const fail = (message: string) =>
        issues.push({ sceneId: scene.id, order: scene.order, message });
      if (ids.has(scene.id) || scene.order !== i + 1)
        fail('Ordem ou identificação das cenas inválida.');
      ids.add(scene.id);
      const visual = visuals.find((s) => s.sceneId === scene.id),
        selection = audio.find((s) => s.sceneId === scene.id);
      const image = assets.find(
          (a) => a.id === visual?.assetId && a.projectId === p.id,
        ),
        voice = assets.find(
          (a) => a.id === selection?.assetId && a.projectId === p.id,
        );
      const imageValid =
        image?.type === 'IMAGE' &&
        image.status === 'READY' &&
        image.storageKey &&
        ['image/png', 'image/jpeg', 'image/webp'].includes(
          image.mimeType ?? '',
        );
      const audioValid =
        voice?.type === 'AUDIO' &&
        (!voice.metadata.audioRole ||
          voice.metadata.audioRole === 'NARRATION') &&
        voice.sceneId === scene.id &&
        voice.status === 'READY' &&
        voice.storageKey &&
        ['audio/mpeg', 'audio/wav'].includes(voice.mimeType ?? '') &&
        Number.isFinite(voice.durationSeconds) &&
        Number(voice.durationSeconds) > 0 &&
        Number(voice.durationSeconds) <= 600;
      if (!imageValid)
        fail('Imagem não selecionada, indisponível ou inválida.');
      else if (visual!.fingerprint !== sceneVisualFingerprint(p, scene))
        fail(
          'A imagem selecionada corresponde a uma versão anterior. Confirme a imagem ou gere novamente.',
        );
      if (!audioValid)
        fail('Narração não selecionada, indisponível ou sem duração válida.');
      else {
        const current = narrationFingerprint(
          scene.narration,
          this.tts.forProject(p),
        );
        const outdated =
          voice.metadata.textHash !== narrationTextHash(scene.narration) ||
          (voice.source === 'AI_GENERATED' &&
            voice.sceneFingerprint !== current);
        if (outdated && selection!.acceptedFingerprint !== current)
          fail(
            'A narração selecionada está desatualizada. Confirme o áudio ou gere novamente.',
          );
      }
      if (!imageValid || !audioValid) return;
      const frames = Math.ceil(
        (Number(voice.durationSeconds) + this.settings.config.paddingSeconds) *
          this.settings.config.fps,
      );
      const startSeconds = frameOffset / this.settings.config.fps;
      frameOffset += frames;
      scenes.push({
        sceneId: scene.id,
        order: scene.order,
        imageAssetId: image.id,
        audioAssetId: voice.id,
        imageKey: image.storageKey!,
        audioKey: voice.storageKey!,
        imageMime: image.mimeType!,
        audioMime: voice.mimeType!,
        audioDurationSeconds: Number(voice.durationSeconds),
        frames,
        startSeconds,
        durationSeconds: frames / this.settings.config.fps,
        endSeconds: frameOffset / this.settings.config.fps,
        motion: this.settings.config.motion
          ? presets[i % presets.length]
          : 'STATIC',
      });
    });
    const totalDurationSeconds = frameOffset / this.settings.config.fps;
    if (totalDurationSeconds > this.settings.maxDurationSeconds)
      issues.push({
        sceneId: null,
        order: null,
        message: `Vídeo excede ${this.settings.maxDurationSeconds} segundos.`,
      });
    const snapshot: RenderSnapshot = {
      projectRevision: p.revision,
      title: p.script?.title ?? p.config.topic,
      config: { ...this.settings.config },
      scenes,
      totalDurationSeconds,
    };
    return { snapshot, issues };
  }
}
