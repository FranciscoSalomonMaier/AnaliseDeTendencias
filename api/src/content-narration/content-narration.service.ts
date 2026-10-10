import {
  Injectable,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import type {
  ContentProject,
  NarrationSettings,
  ProjectScene,
} from '../content-projects/content-project.schema';
import type { ContentAsset } from '../content-assets/content-asset';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { StorageProvider } from '../content-assets/storage.provider';
import { NarrationRepository } from './narration.repository';
import {
  TtsSettings,
  TTS_VOICES,
  TTS_STYLES,
  NarrationInputSchema,
  narrationFingerprint,
  narrationTextHash,
} from './tts-settings';
import { TtsProvider } from './tts.provider';
import { AudioFileValidator, AudioUpload } from './audio-file.validator';
const RequestSchema = z.object({
  revision: z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().nonnegative()),
  confirm: z.boolean().default(false),
});
@Injectable()
export class ContentNarrationService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ContentNarrationService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;
  private stopped = false;
  private readonly running = new Set<Promise<void>>();
  constructor(
    private readonly projects: ContentProjectRepository,
    private readonly assets: ContentAssetRepository,
    private readonly repository: NarrationRepository,
    private readonly storage: StorageProvider,
    private readonly provider: TtsProvider,
    private readonly validator: AudioFileValidator,
    private readonly settings: TtsSettings,
  ) {}
  async onApplicationBootstrap() {
    this.stopped = false;
    await this.repository.startWorker();
    this.timer = setInterval(() => void this.drain(), 1000);
    this.timer.unref();
    void this.drain();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.running]);
    // drain may still be awaiting a claim; let it observe stopped before releasing the lease.
    while (this.draining) await new Promise<void>((r) => setTimeout(r, 10));
    await this.repository.stopWorker();
  }
  private request(input: unknown) {
    const parsed = RequestSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Informe a revisão atual do projeto.');
    return parsed.data;
  }
  private revision(p: ContentProject, r: number) {
    if (p.revision !== r)
      throw new ConflictException(
        'Projeto alterado em outra janela. Reabra para continuar.',
      );
  }
  private approved(p: ContentProject) {
    if (p.status !== 'SCENES_APPROVED' || p.scenesStale || p.scriptStale)
      throw new ConflictException(
        'Aprove as cenas atuais antes de produzir narrações.',
      );
  }
  private scene(p: ContentProject, id: string) {
    const s = p.scenes.find((x) => x.id === id);
    if (!s)
      throw new NotFoundException(
        'Cena não pertence ao projeto ou não existe.',
      );
    return s;
  }
  private async transaction<T>(client: PoolClient, work: () => Promise<T>) {
    await client.query('BEGIN');
    try {
      const r = await work();
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  private async state(p: ContentProject, client?: PoolClient) {
    const [all, selections] = await Promise.all([
      this.assets.list(p.id, client),
      this.repository.selections(p.id, client),
    ]);
    const assets = all.filter(
      (a) =>
        a.type === 'AUDIO' &&
        (!a.metadata.audioRole || a.metadata.audioRole === 'NARRATION'),
    );
    const settings = this.settings.forProject(p);
    const scenes = p.scenes.map((scene) => {
      const selection = selections.find((x) => x.sceneId === scene.id),
        asset = assets.find((a) => a.id === selection?.assetId);
      const textOutdated = Boolean(
        asset && asset.metadata.textHash !== narrationTextHash(scene.narration),
      );
      const settingsOutdated = Boolean(
        asset?.source === 'AI_GENERATED' &&
        asset.sceneFingerprint !==
          narrationFingerprint(scene.narration, settings),
      );
      const outdated =
        textOutdated || settingsOutdated || p.scriptStale || p.scenesStale;
      const accepted = Boolean(
        selection?.acceptedFingerprint ===
        narrationFingerprint(scene.narration, settings),
      );
      return {
        sceneId: scene.id,
        selectedAssetId: asset?.id ?? null,
        textOutdated,
        settingsOutdated,
        outdated,
        accepted,
        ready: Boolean(
          asset?.status === 'READY' &&
          asset.storageKey &&
          asset.durationSeconds &&
          (!outdated || accepted) &&
          !p.scriptStale &&
          !p.scenesStale,
        ),
        durationSeconds: asset?.durationSeconds ?? null,
      };
    });
    return {
      assets,
      selections,
      scenes,
      settings,
      voices: TTS_VOICES,
      styles: Object.keys(TTS_STYLES),
      readyCount: scenes.filter((s) => s.ready).length,
      totalCount: p.scenes.length,
      busyCount: assets.filter(
        (a) =>
          a.sceneId &&
          p.scenes.some((s) => s.id === a.sceneId) &&
          ['PENDING', 'GENERATING'].includes(a.status),
      ).length,
      sampleBusy: assets.some(
        (a) =>
          a.metadata.sample && ['PENDING', 'GENERATING'].includes(a.status),
      ),
      uploadMaxBytes: this.settings.uploadMaxBytes,
      maxTextLength: this.settings.maxTextLength,
    };
  }
  async list(id: string, sceneId?: string) {
    const p = await this.projects.get(id);
    if (sceneId) this.scene(p, sceneId);
    const state = await this.state(p);
    return sceneId
      ? {
          ...state,
          assets: state.assets.filter((a) => a.sceneId === sceneId),
          scenes: state.scenes.filter((s) => s.sceneId === sceneId),
        }
      : state;
  }
  async saveSettings(id: string, input: unknown) {
    const { revision } = this.request(input);
    const parsed = NarrationInputSchema.safeParse({
      voice: (input as Record<string, unknown>)?.voice,
      style: (input as Record<string, unknown>)?.style,
      speed: (input as Record<string, unknown>)?.speed,
    });
    if (!parsed.success)
      throw new BadRequestException(
        'Voz, estilo ou velocidade de narração inválidos.',
      );
    return this.projects.locked(id, async (p, client) => {
      this.revision(p, revision);
      p.narrationSettings = { ...this.settings.forProject(p), ...parsed.data };
      // Language remains the project's language; model/format are centrally configured on first save.
      p.narrationSettings.language = p.config.language;
      return this.projects.save(p, client);
    });
  }
  private asset(
    p: ContentProject,
    scene: ProjectScene | null,
    source: ContentAsset['source'],
    settings: NarrationSettings,
  ): ContentAsset {
    const now = new Date().toISOString(),
      text =
        scene?.narration.trim() ??
        'Esta é uma amostra de narração em português do Brasil. Uma história começa com uma voz.';
    return {
      id: randomUUID(),
      projectId: p.id,
      sceneId: scene?.id ?? null,
      type: 'AUDIO',
      source,
      status: 'PENDING',
      usage: 'OPTIONAL',
      storageKey: null,
      url: null,
      mimeType: null,
      width: null,
      height: null,
      durationSeconds: null,
      voice: source === 'AI_GENERATED' ? settings.voice : null,
      provider: source === 'AI_GENERATED' ? settings.provider : null,
      model: source === 'AI_GENERATED' ? settings.model : null,
      originalPrompt: text,
      finalGenerationPrompt:
        source === 'AI_GENERATED'
          ? TTS_STYLES[settings.style as keyof typeof TTS_STYLES]
          : null,
      sceneFingerprint: narrationFingerprint(text, settings),
      metadata: { textHash: narrationTextHash(text), settings, sample: !scene },
      tokenUsage: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  async generate(
    id: string,
    sceneId: string | null,
    input: unknown,
    sample = false,
  ) {
    const request = this.request(input);
    if ((!sceneId || sample) && !request.confirm)
      throw new ConflictException(
        'Confirme a geração de narração que pode consumir créditos.',
      );
    const jobs = await this.projects.locked(id, async (p, client) => {
      this.revision(p, request.revision);
      if (!sample) this.approved(p);
      const state = await this.state(p, client),
        settings = this.settings.forProject(p);
      const targets: Array<ProjectScene | null> = sample
        ? [null]
        : sceneId
          ? [this.scene(p, sceneId)]
          : p.scenes.filter(
              (s) => !state.scenes.find((x) => x.sceneId === s.id)?.ready,
            );
      const pending = (sid: string | null) =>
        state.assets.some(
          (a) =>
            a.sceneId === sid && ['PENDING', 'GENERATING'].includes(a.status),
        );
      if ((sceneId || sample) && pending(sceneId))
        throw new ConflictException(
          'Já existe uma geração de narração em andamento.',
        );
      const available = targets.filter((s) => !pending(s?.id ?? null));
      for (const s of available)
        if (s) this.settings.validateText(s.narration.trim());
      return this.transaction(client, async () => {
        // Serialize the global capacity check across different projects as well.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('content-tts:capacity',0))",
        );
        if (
          (await this.repository.queuedCount(client)) + available.length >
          this.settings.maxQueued
        )
          throw new ConflictException(
            'Fila de narrações cheia. Aguarde e tente novamente.',
          );
        const result: ContentAsset[] = [];
        for (const s of available) {
          const a = this.asset(p, s, 'AI_GENERATED', settings);
          a.metadata.previousSelection =
            state.selections.find((x) => x.sceneId === s?.id)?.assetId ?? null;
          await this.repository.insert(a, client);
          result.push(a);
        }
        return result;
      });
    });
    void this.drain();
    return { queued: jobs.length, assetIds: jobs.map((a) => a.id) };
  }
  async drain() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (!this.stopped && this.running.size < this.settings.concurrency) {
        const asset = await this.repository.claim();
        if (!asset) break;
        if (this.stopped) {
          await this.assets.failed(
            asset.id,
            'Geração interrompida pelo encerramento da API. Tente novamente.',
          );
          break;
        }
        const work = this.generateAsset(asset)
          .catch(() =>
            this.logger.error(
              'Falha ao persistir o resultado de uma narração.',
            ),
          )
          .finally(() => {
            this.running.delete(work);
            void this.drain();
          });
        this.running.add(work);
      }
    } catch {
      this.logger.error('Fila de narração temporariamente indisponível.');
    } finally {
      this.draining = false;
    }
  }
  private async store(
    asset: ContentAsset,
    buffer: Buffer,
    mime: string,
    filename?: string,
  ) {
    const file = await this.validator.validate(buffer, mime, filename);
    const key = `content-projects/${asset.projectId}/${asset.sceneId ? `scenes/${asset.sceneId}/audio` : 'audio-samples'}/${asset.id}.${file.extension}`;
    await this.storage.save(key, file.audio);
    asset.storageKey = key;
    asset.mimeType = file.mimeType;
    asset.durationSeconds = file.durationSeconds;
    asset.metadata = {
      ...asset.metadata,
      ...file.metadata,
      durationSeconds: file.durationSeconds,
    };
    return key;
  }
  private async finish(asset: ContentAsset) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await this.projects.locked(asset.projectId, async (p, client) =>
          this.transaction(client, async () => {
            await this.repository.ready(asset, client);
            const scene = p.scenes.find((s) => s.id === asset.sceneId);
            if (
              !scene ||
              p.status !== 'SCENES_APPROVED' ||
              p.scriptStale ||
              p.scenesStale ||
              asset.sceneFingerprint !==
                narrationFingerprint(
                  scene.narration,
                  this.settings.forProject(p),
                )
            )
              return;
            const current = (
              await this.repository.selections(p.id, client)
            ).find((x) => x.sceneId === scene.id);
            if ((current?.assetId ?? null) === asset.metadata.previousSelection)
              await this.repository.select(
                p.id,
                scene.id,
                asset.id,
                null,
                client,
              );
          }),
        );
        return;
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          await this.repository.ready(asset);
          return;
        }
        await new Promise<void>((r) => setTimeout(r, 50));
      }
    }
    await this.repository.ready(asset);
  }
  private async generateAsset(asset: ContentAsset) {
    let key: string | undefined;
    try {
      const result = await this.provider.generateSpeech({
        text: asset.originalPrompt!,
        settings: asset.metadata.settings as NarrationSettings,
        instructions: asset.finalGenerationPrompt!,
      });
      asset.provider = result.provider;
      asset.model = result.model;
      asset.voice = result.voice;
      asset.tokenUsage = result.usage;
      asset.metadata = { ...asset.metadata, ...result.metadata };
      key = await this.store(asset, result.audio, result.mimeType);
      await this.finish(asset);
    } catch (error) {
      const persisted = await this.assets
        .get(asset.projectId, asset.id)
        .catch(() => undefined);
      if (persisted?.status === 'READY') return;
      if (key) await this.storage.delete(key).catch(() => undefined);
      await this.assets.failed(
        asset.id,
        error instanceof HttpException
          ? error.message
          : 'Não foi possível salvar ou gerar a narração. Tente novamente.',
        asset,
      );
    }
  }
  async upload(
    id: string,
    sceneId: string,
    input: unknown,
    file?: AudioUpload,
  ) {
    const request = this.request(input);
    if (!file) throw new BadRequestException('Envie um áudio no campo file.');
    return this.projects.locked(id, async (p, client) => {
      this.revision(p, request.revision);
      this.approved(p);
      const scene = this.scene(p, sceneId),
        a = this.asset(p, scene, 'USER_UPLOAD', this.settings.forProject(p));
      let key: string | undefined;
      try {
        key = await this.store(
          a,
          file.buffer,
          file.mimetype,
          file.originalname,
        );
        await this.transaction(client, async () => {
          await this.repository.insert(a, client);
          await this.repository.ready(a, client);
          await this.repository.select(id, sceneId, a.id, null, client);
        });
      } catch (error) {
        if (key) await this.storage.delete(key).catch(() => undefined);
        if (error instanceof HttpException) throw error;
        throw new BadRequestException(
          'Não foi possível armazenar o áudio. Tente novamente.',
        );
      }
      return this.state(p, client);
    });
  }
  async select(id: string, sceneId: string, assetId: string, input: unknown) {
    const request = this.request(input);
    return this.projects.locked(id, async (p, client) => {
      this.revision(p, request.revision);
      this.approved(p);
      const scene = this.scene(p, sceneId),
        asset = await this.assets.get(id, assetId, client);
      if (
        asset.type !== 'AUDIO' ||
        (asset.metadata.audioRole &&
          asset.metadata.audioRole !== 'NARRATION') ||
        asset.sceneId !== sceneId ||
        asset.status !== 'READY' ||
        !asset.durationSeconds
      )
        throw new ConflictException(
          'Áudio não pertence à cena ou não está pronto.',
        );
      await this.repository.select(
        id,
        sceneId,
        assetId,
        narrationFingerprint(scene.narration, this.settings.forProject(p)),
        client,
      );
      return this.state(p, client);
    });
  }
}
