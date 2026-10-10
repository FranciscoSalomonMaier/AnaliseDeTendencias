import { Injectable } from '@nestjs/common';
import type { ContentAsset } from '../content-assets/content-asset';
import type { RenderSnapshot } from '../video-render/render-job';
import type { RenderIssue } from '../video-render/timeline.builder';
import {
  audioRole,
  projectAudioSchema,
  ProjectAudioSettings,
} from './project-audio.schema';
export interface MixAsset {
  assetId: string;
  storageKey: string;
  mimeType: string;
  durationSeconds: number;
  originalName: string;
  license: string;
  origin: string;
  notes: string;
}
export interface TimedEffect extends MixAsset {
  id: string;
  sceneId: string;
  order: number;
  startOffsetSeconds: number;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  sourceDurationSeconds: number;
  volume: number;
  scope: 'SCENE';
}
export interface AudioMixSnapshot {
  settings: ProjectAudioSettings;
  music: MixAsset | null;
  effects: TimedEffect[];
}
@Injectable()
export class AudioTimelineBuilder {
  build(
    timeline: RenderSnapshot,
    settings: ProjectAudioSettings,
    assets: ContentAsset[],
    projectId: string,
  ) {
    const issues: RenderIssue[] = [],
      effects: TimedEffect[] = [];
    let music: MixAsset | null = null;
    const parsed = projectAudioSchema.safeParse(settings);
    if (!parsed.success)
      return {
        mix: { settings, music, effects },
        issues: [
          {
            sceneId: null,
            order: null,
            message:
              'Configurações de mixagem inválidas. Revise volumes, fades e efeitos.',
          },
        ],
      };
    const pick = (
      id: string,
      role: 'BACKGROUND_MUSIC' | 'SOUND_EFFECT',
      sceneId: string | null,
      order: number | null,
    ): MixAsset | null => {
      const a = assets.find((a) => a.id === id && a.projectId === projectId);
      if (
        !a ||
        a.type !== 'AUDIO' ||
        a.status !== 'READY' ||
        audioRole(a) !== role ||
        !a.storageKey ||
        !['audio/mpeg', 'audio/wav'].includes(a.mimeType ?? '') ||
        !Number.isFinite(a.durationSeconds) ||
        Number(a.durationSeconds) <= 0 ||
        Number(a.durationSeconds) > 600
      ) {
        issues.push({
          sceneId,
          order,
          message:
            role === 'BACKGROUND_MUSIC'
              ? 'Música selecionada não pertence ao projeto, está indisponível ou é inválida.'
              : 'Efeito sonoro selecionado está indisponível ou é inválido.',
        });
        return null;
      }
      const meta = (key: string) =>
        typeof a.metadata[key] === 'string' ? a.metadata[key] : '';
      return {
        assetId: a.id,
        storageKey: a.storageKey,
        mimeType: a.mimeType!,
        durationSeconds: Number(a.durationSeconds),
        originalName: meta('originalName'),
        license: meta('license'),
        origin: meta('origin'),
        notes: meta('notes'),
      };
    };
    if (settings.backgroundMusicAssetId) {
      music = pick(
        settings.backgroundMusicAssetId,
        'BACKGROUND_MUSIC',
        null,
        null,
      );
      if (music) {
        const available = settings.loopMusic
          ? timeline.totalDurationSeconds
          : Math.min(music.durationSeconds, timeline.totalDurationSeconds);
        if (
          available > 0 &&
          settings.musicFadeInSeconds + settings.musicFadeOutSeconds > available
        )
          issues.push({
            sceneId: null,
            order: null,
            message: `A soma dos fades da música deve ser de até ${available.toFixed(2)} segundos.`,
          });
      }
    }
    for (const effect of settings.effects.filter((e) => e.enabled)) {
      const scene = timeline.scenes.find((s) => s.sceneId === effect.sceneId);
      if (!scene) {
        issues.push({
          sceneId: effect.sceneId,
          order: null,
          message:
            'Efeito associado a uma cena ausente ou sem narração/imagem válida.',
        });
        continue;
      }
      const asset = pick(
        effect.assetId,
        'SOUND_EFFECT',
        scene.sceneId,
        scene.order,
      );
      if (effect.startOffsetSeconds >= scene.durationSeconds) {
        issues.push({
          sceneId: scene.sceneId,
          order: scene.order,
          message:
            'O offset do efeito deve ser menor que a duração real da cena.',
        });
        continue;
      }
      if (asset) {
        const startSeconds = scene.startSeconds + effect.startOffsetSeconds,
          durationSeconds = Math.min(
            asset.durationSeconds,
            scene.durationSeconds - effect.startOffsetSeconds,
          );
        effects.push({
          ...asset,
          id: effect.id,
          sceneId: scene.sceneId,
          order: scene.order,
          startOffsetSeconds: effect.startOffsetSeconds,
          startSeconds,
          durationSeconds,
          endSeconds: startSeconds + durationSeconds,
          sourceDurationSeconds: asset.durationSeconds,
          volume: effect.volume,
          scope: 'SCENE',
        });
      }
    }
    return {
      mix: { settings: structuredClone(settings), music, effects },
      issues,
    };
  }
}
