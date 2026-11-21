import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { mkdir, mkdtemp, rm, stat, statfs } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { StorageProvider } from '../content-assets/storage.provider';
import { MediaProcess } from '../video-render/media-process';
import { LlmProvider } from '../ai/llm.provider';
import { ShortSettings } from './short.settings';
import { ShortProject, ShortFile } from './short.schema';
import {
  canonicalHash,
  intelligentDependencies,
  IntelligentPlan,
} from './short-engine.schema';
import { resolveNarrationMode } from './short-narration.schema';
import { editorialPreferencesSchema } from './short-editorial.schema';
import {
  contextInputSchema,
  type PlanningInput,
} from './planning/planning.schema';
import { buildPlanningContext } from './planning/planning-context';
import { validatePlanningResponse } from './planning/planning-validator';
import { EditorialPlanningService } from './planning/planning.service';
import { LlmPlanningAdapter } from './planning/planning-ai.adapter';
import {
  inspectResourceEnvironment,
  resourceCapabilities,
} from './resources/editing-resource.capabilities';
import { probeMedia, readVideoMetadata } from './execution/execution-preflight';
import { EditingPlanExecutor } from './execution/execution.service';
export async function fileDigest(path: string) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest('hex');
}
@Injectable()
export class ShortIntelligentService {
  constructor(
    readonly settings: ShortSettings,
    readonly storage: StorageProvider,
    readonly process: MediaProcess,
    readonly llm: LlmProvider,
  ) {}
  get binaries() {
    return {
      ffmpegPath:
        this.settings.config.get<string>('FFMPEG_PATH') || ffmpeg || 'ffmpeg',
      ffprobePath:
        this.settings.config.get<string>('FFPROBE_PATH') || ffprobe.path,
    };
  }
  assertEnabled(p?: ShortProject) {
    if (!this.settings.intelligentEnabled)
      throw new ServiceUnavailableException(
        'Edição inteligente desabilitada no servidor.',
      );
    if (p && !this.settings.intelligentCombination(p.data.classification))
      throw new BadRequestException(
        'Combinação editorial não autorizada para teste neste ambiente.',
      );
  }
  async prepare(
    p: ShortProject,
    files: ShortFile[],
    planningId: string,
    signal: AbortSignal,
    activationChecked = false,
  ) {
    if (!activationChecked) this.assertEnabled(p);
    if (!files.length || files.length > 8 || !p.data.scriptApproved)
      throw new BadRequestException(
        'Aprove o roteiro e envie até oito vídeos autorizados.',
      );
    if (!this.storage.copyTo || !this.storage.stat)
      throw Error('Storage incompatível.');
    await mkdir(this.settings.tempDir, { recursive: true, mode: 0o700 });
    const disk = await statfs(this.settings.tempDir);
    const bytes =
      files.reduce((n, f) => n + Number(f.bytes), 0) +
      (p.data.audio?.bytes ?? 0) +
      (p.data.music?.bytes ?? 0) +
      (p.data.soundEffects ?? []).reduce((n, e) => n + e.bytes, 0);
    if (Number(disk.bavail) * Number(disk.bsize) < bytes * 2 + 512 * 1024 ** 2)
      throw new BadRequestException(
        'Espaço em disco insuficiente para os materiais e as cópias de execução.',
      );
    const dir = await mkdtemp(
      join(this.settings.tempDir, 'short-intelligent-'),
    );
    try {
      const paths = new Map<string, string>(),
        hashes: Record<string, string> = {};
      const copy = async (
        id: string,
        key: string,
        bytes: number,
        max: number,
      ) => {
        signal.throwIfAborted();
        if (
          !Number.isFinite(bytes) ||
          bytes <= 0 ||
          bytes > max ||
          (await this.storage.stat!(key)).size !== bytes
        )
          throw new BadRequestException(
            'Material ausente, alterado ou acima dos limites do motor.',
          );
        const path = join(dir, id + extname(key));
        await this.storage.copyTo!(key, path);
        if ((await stat(path)).size !== bytes) throw Error('Cópia incompleta.');
        hashes[id] = await fileDigest(path);
        paths.set(id, path);
        return path;
      };
      const videos: PlanningInput['videos'] = [];
      for (const f of files) {
        if (f.project_id !== p.id || f.role === 'REFERENCE')
          throw Error('Fonte não autorizada.');
        const path = await copy(
          f.id,
          f.storage_key,
          Number(f.bytes),
          512 * 1024 ** 2,
        );
        const m = readVideoMetadata(
          await probeMedia(this.process, this.binaries, path, signal),
        );
        if (
          m.duration > 600 ||
          Math.abs(m.duration - f.duration) > 1 / 30 ||
          m.width !== f.width ||
          m.height !== f.height ||
          Math.abs(m.fps - f.fps) > 0.01
        )
          throw new BadRequestException(
            'Vídeo incompatível com os metadados ou acima de dez minutos.',
          );
        videos.push({
          metadata: {
            id: f.id,
            duration: m.duration,
            width: m.width,
            height: m.height,
            fps: m.fps,
          },
          codec: m.videoCodec,
          hasAudio: m.hasAudio,
          ...(m.hasAudio
            ? {
                audio: {
                  id: f.id,
                  duration: m.duration,
                  sampleRate: m.sampleRate!,
                  channels: m.channels,
                  codec: m.audioCodec!,
                  kind: 'VIDEO' as const,
                },
              }
            : {}),
          usableIntervals: [{ start: 0, end: m.duration }],
          description: null,
        });
      }
      const audios: PlanningInput['audios'] = [];
      const addAudio = async (
        id: string,
        key: string,
        bytes: number,
        role: 'NARRATION' | 'MUSIC' | 'EFFECT',
      ) => {
        const path = await copy(id, key, bytes, 64 * 1024 ** 2),
          probe = await probeMedia(this.process, this.binaries, path, signal);
        const a = probe.streams?.filter((x) => x.codec_type === 'audio');
        if (a?.length !== 1) throw Error('Áudio inválido.');
        const duration = Number(a[0].duration ?? probe.format?.duration);
        audios.push({
          metadata: {
            id,
            duration,
            sampleRate: Number(a[0].sample_rate),
            channels: a[0].channels!,
            codec: a[0].codec_name!,
            kind: 'AUDIO' as const,
          },
          role,
          usableIntervals: [{ start: 0, end: duration }],
        });
      };
      if (resolveNarrationMode(p.data) === 'WITH_NARRATION') {
        if (!p.data.audio || !p.data.textApproved)
          throw new BadRequestException(
            'Aprove o texto e gere a narração primeiro.',
          );
        await addAudio(
          'narration',
          p.data.audio.key,
          p.data.audio.bytes,
          'NARRATION',
        );
      }
      if (p.data.music && p.data.musicEnabled !== false)
        await addAudio(
          p.data.music.id,
          p.data.music.key,
          p.data.music.bytes,
          'MUSIC',
        );
      for (const effect of p.data.soundEffects ?? [])
        await addAudio(effect.id, effect.key, effect.bytes, 'EFFECT');
      const context = contextInputSchema.parse({
        version: 1,
        planningId,
        classification: p.data.classification,
        editorialPreferences:
          p.data.editorialPreferences ??
          editorialPreferencesSchema.parse({ version: 1 }),
        narration: { version: 1, mode: resolveNarrationMode(p.data) },
        script: p.data.script,
        target: {
          width: 1080,
          height: 1920,
          fps: 30,
          durationSeconds: p.target_seconds,
        },
        videos,
        audios,
        images: [],
        observations: [],
        timedText: [],
        displayTexts: [],
        additionalInstructions:
          (p.data.editorialPreferences?.additionalInstructions ?? '') +
          '\nNão há análise semântica nem timestamps de fala. Gere somente plano técnico conservador; não invente eventos, rankings, legendas ou fatos. Configuração sonora autorizada: ' +
          JSON.stringify(p.data.musicSettings ?? {}),
      });
      const capabilities = resourceCapabilities(
        await inspectResourceEnvironment(this.process, this.binaries, signal),
      );
      const authority = {
        authorizedAssetIds: new Set(paths.keys()),
        capabilities,
      };
      const fingerprint = canonicalHash({
        dependencies: intelligentDependencies(p.data),
        target: p.target_seconds,
        files: files.map((f) => ({
          id: f.id,
          key: f.storage_key,
          bytes: f.bytes,
        })),
        hashes,
        context: { ...context, planningId: undefined },
        libraryVersion: 3,
      });
      return {
        dir,
        paths,
        context,
        authority,
        fingerprint,
        dispose: () => rm(dir, { recursive: true, force: true }),
      };
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
  }
  async validate(
    p: ShortProject,
    files: ShortFile[],
    record: IntelligentPlan,
    signal: AbortSignal,
    activationChecked = false,
  ) {
    const prepared = await this.prepare(
      p,
      files,
      record.id,
      signal,
      activationChecked,
    );
    try {
      if (
        (record.status === 'APPROVED' &&
          record.approvedPlanHash !== canonicalHash(record.plan)) ||
        record.fingerprint !== prepared.fingerprint ||
        canonicalHash(record.context) !== canonicalHash(prepared.context)
      )
        throw new BadRequestException(
          'Plano obsoleto: os materiais ou a configuração mudaram. Gere um novo plano.',
        );
      const v = validatePlanningResponse(
        record.plan,
        buildPlanningContext(prepared.context, prepared.authority),
      );
      if (v.diagnostics.some((d) => d.level === 'ERROR'))
        throw new BadRequestException(
          'Plano inválido: revise os diagnósticos.',
        );
      return v;
    } finally {
      await prepared.dispose();
    }
  }
  async plan(
    p: ShortProject,
    files: ShortFile[],
    jobId: string,
    signal: AbortSignal,
  ) {
    this.assertEnabled(p);
    if (!this.settings.intelligentPaidPlanning || !this.settings.enabled)
      throw new ServiceUnavailableException(
        'Planejamento pago não autorizado no servidor.',
      );
    const prepared = await this.prepare(p, files, jobId, signal, true);
    try {
      return {
        result: await new EditorialPlanningService(
          new LlmPlanningAdapter(this.llm, this.settings.model, {
            allowPaidPlanning: true,
          }),
          prepared.authority,
        ).plan(prepared.context, signal),
        prepared,
      };
    } catch (e) {
      await prepared.dispose();
      throw e;
    }
  }
  async render(
    p: ShortProject,
    files: ShortFile[],
    record: IntelligentPlan,
    executionId: string,
    signal: AbortSignal,
    onPhase: (phase: string) => Promise<void>,
  ) {
    if (
      record.status !== 'APPROVED' ||
      !record.approvalId ||
      record.approvedPlanHash !== canonicalHash(record.plan)
    )
      throw new BadRequestException('Aprove o plano antes de renderizar.');
    this.assertEnabled(p);
    await this.validate(p, files, record, signal, true);
    const prepared = await this.prepare(p, files, record.id, signal, true);
    let updates = Promise.resolve();
    try {
      const result = await new EditingPlanExecutor(this.process, {
        ...this.binaries,
        tempDir: this.settings.tempDir,
        sourceRoot: prepared.dir,
        onPhase: (phase) => {
          updates = updates.then(() => onPhase(phase));
          updates.catch(() => {});
        },
      }).execute(
        {
          version: 1,
          executionId,
          context: prepared.context,
          plan: record.plan,
        },
        {
          authorizedAssetIds: prepared.authority.authorizedAssetIds,
          resolve: async (id) => {
            const path = prepared.paths.get(id);
            if (!path) throw Error('Fonte não autorizada.');
            return path;
          },
        },
        signal,
      );
      try {
        await updates;
      } catch (e) {
        if (result.status === 'SUCCESS') await result.dispose();
        throw e;
      }
      return result;
    } finally {
      await prepared.dispose();
    }
  }
}
