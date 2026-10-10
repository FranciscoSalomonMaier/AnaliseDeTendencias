import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import {
  ContentProject,
  ProjectScene,
} from '../content-projects/content-project.schema';
import { AssetUsage, ContentAsset, VisualState } from './content-asset';
import { ContentAssetRepository } from './content-asset.repository';
import { ImageProvider } from './image.provider';
import { StorageProvider } from './storage.provider';
import {
  SceneImagePromptBuilder,
  sceneVisualFingerprint,
} from './scene-image-prompt.builder';
import { ImageFileValidator, ImageUpload } from './image-file.validator';
import { IMAGE_UPLOAD_MAX_BYTES, ImageSettings } from './image-settings';
import { ImageGenerationQueue } from './image-generation.queue';

const RequestSchema = z.object({
  revision: z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().nonnegative()),
  confirm: z.boolean().default(false),
});
@Injectable()
export class ContentAssetsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ContentAssetsService.name);
  constructor(
    private readonly projects: ContentProjectRepository,
    private readonly assets: ContentAssetRepository,
    private readonly provider: ImageProvider,
    private readonly storage: StorageProvider,
    private readonly builder: SceneImagePromptBuilder,
    private readonly validator: ImageFileValidator,
    private readonly queue: ImageGenerationQueue,
    private readonly settings: ImageSettings,
  ) {}
  async onApplicationBootstrap() {
    await this.assets.recoverInterrupted();
  }
  async onModuleDestroy() {
    await this.assets.releaseWorker();
  }
  private request(input: unknown) {
    const parsed = RequestSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Informe a revisão atual do projeto.');
    return parsed.data;
  }
  private revision(p: ContentProject, revision: number) {
    if (p.revision !== revision)
      throw new ConflictException(
        'Projeto alterado em outra janela. Reabra para continuar.',
      );
  }
  private approved(p: ContentProject) {
    if (p.status !== 'SCENES_APPROVED' || p.scenesStale || p.scriptStale)
      throw new ConflictException(
        'Aprove as cenas atuais antes de produzir imagens.',
      );
  }
  private scene(p: ContentProject, id: string) {
    const scene = p.scenes.find((s) => s.id === id);
    if (!scene)
      throw new NotFoundException(
        'Cena não pertence ao projeto ou não existe.',
      );
    return scene;
  }
  private async transaction<T>(client: PoolClient, work: () => Promise<T>) {
    await client.query('BEGIN');
    try {
      const result = await work();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  private async state(
    p: ContentProject,
    client?: PoolClient,
  ): Promise<VisualState> {
    const [allAssets, selections] = await Promise.all([
      this.assets.list(p.id, client),
      this.assets.selections(p.id, client),
    ]);
    const assets = allAssets.filter((a) => a.type === 'IMAGE');
    const scenes = p.scenes.map((scene) => {
      const selected = selections.find((s) => s.sceneId === scene.id);
      const asset = assets.find((a) => a.id === selected?.assetId);
      return {
        sceneId: scene.id,
        selectedAssetId: selected?.assetId ?? null,
        outdated: Boolean(
          selected &&
          (selected.fingerprint !== sceneVisualFingerprint(p, scene) ||
            p.scenesStale ||
            p.scriptStale),
        ),
        ready: asset?.status === 'READY',
      };
    });
    return {
      assets,
      selections,
      scenes,
      readyCount: scenes.filter((s) => s.ready).length,
      totalCount: scenes.length,
      busyCount: assets.filter((a) =>
        ['PENDING', 'GENERATING'].includes(a.status),
      ).length,
      referencesSupported: false,
      uploadMaxBytes: IMAGE_UPLOAD_MAX_BYTES,
    };
  }
  async list(id: string) {
    return this.state(await this.projects.get(id));
  }
  async listScene(id: string, sceneId: string) {
    const project = await this.projects.get(id);
    this.scene(project, sceneId);
    const state = await this.state(project);
    return {
      ...state,
      assets: state.assets.filter((a) => a.sceneId === sceneId),
      scenes: state.scenes.filter((s) => s.sceneId === sceneId),
    };
  }
  private asset(
    p: ContentProject,
    scene: ProjectScene | null,
    source: ContentAsset['source'],
    usage: AssetUsage,
  ): ContentAsset {
    const now = new Date().toISOString();
    const request = scene ? this.builder.build(p, scene) : null;
    return {
      id: randomUUID(),
      projectId: p.id,
      sceneId: scene?.id ?? null,
      type: 'IMAGE',
      source,
      usage,
      status: 'PENDING',
      storageKey: null,
      url: null,
      mimeType: null,
      width: null,
      height: null,
      provider: source === 'AI_GENERATED' ? this.settings.provider : null,
      model: source === 'AI_GENERATED' ? this.settings.model : null,
      originalPrompt: scene?.imagePrompt ?? null,
      finalGenerationPrompt: source === 'AI_GENERATED' ? request!.prompt : null,
      sceneFingerprint: scene ? sceneVisualFingerprint(p, scene) : null,
      metadata:
        request && source === 'AI_GENERATED'
          ? { aspectRatio: request.aspectRatio, style: request.style }
          : {},
      tokenUsage: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  async generate(id: string, sceneId: string | null, input: unknown) {
    const request = this.request(input);
    if (!sceneId && !request.confirm)
      throw new ConflictException('Confirme a geração das imagens faltantes.');
    const jobs = await this.projects.locked(id, async (p, client) => {
      this.revision(p, request.revision);
      this.approved(p);
      const state = await this.state(p, client);
      const targets = sceneId
        ? [this.scene(p, sceneId)]
        : p.scenes.filter(
            (s) => !state.scenes.find((v) => v.sceneId === s.id)?.ready,
          );
      const pending = (sid: string) =>
        state.assets.some(
          (a) =>
            a.sceneId === sid && ['PENDING', 'GENERATING'].includes(a.status),
        );
      if (sceneId && pending(sceneId))
        throw new ConflictException('Já existe uma geração para esta cena.');
      const available = targets.filter((s) => !pending(s.id));
      this.queue.ensureCapacity(available.length);
      return this.transaction(client, async () => {
        const result: ContentAsset[] = [];
        for (const scene of available) {
          const asset = this.asset(p, scene, 'AI_GENERATED', 'OPTIONAL');
          asset.metadata.previousSelection =
            state.selections.find((s) => s.sceneId === scene.id)?.assetId ??
            null;
          await this.assets.insert(asset, client);
          result.push(asset);
        }
        return result;
      });
    });
    for (const asset of jobs)
      this.queue.enqueue(() => this.generateAsset(asset));
    return { queued: jobs.length, assetIds: jobs.map((a) => a.id) };
  }
  private async store(
    asset: ContentAsset,
    buffer: Buffer,
    mimeType: string,
    filename?: string,
  ) {
    const file = await this.validator.validate(buffer, mimeType, filename);
    const scope = asset.sceneId ? `scenes/${asset.sceneId}` : 'references';
    const key = `content-projects/${asset.projectId}/${scope}/${asset.id}.${file.extension}`;
    await this.storage.save(key, file.image);
    asset.storageKey = key;
    asset.mimeType = file.mimeType;
    asset.width = file.width;
    asset.height = file.height;
    return key;
  }
  private async finish(asset: ContentAsset) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await this.projects.locked(asset.projectId, async (p, client) =>
          this.transaction(client, async () => {
            await this.assets.ready(asset, client);
            const scene = p.scenes.find((s) => s.id === asset.sceneId);
            if (
              !scene ||
              p.status !== 'SCENES_APPROVED' ||
              p.scenesStale ||
              p.scriptStale ||
              sceneVisualFingerprint(p, scene) !== asset.sceneFingerprint
            )
              return;
            const selection = (await this.assets.selections(p.id, client)).find(
              (s) => s.sceneId === scene.id,
            );
            // An explicit selection made while generating must win over the background result.
            if (
              (selection?.assetId ?? null) === asset.metadata.previousSelection
            )
              await this.assets.select(
                p.id,
                scene.id,
                asset.id,
                asset.sceneFingerprint,
                client,
              );
          }),
        );
        return;
      } catch (error) {
        // Retry short sibling completions; retain READY bytes even when selection cannot be updated.
        if (!(error instanceof ConflictException)) {
          this.logger.warn(
            'Imagem salva; seleção automática indisponível. Selecione a variação na interface.',
          );
          await this.assets.ready(asset);
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
    await this.assets.ready(asset);
  }
  private async generateAsset(asset: ContentAsset) {
    let key: string | undefined;
    try {
      await this.assets.generating(asset.id);
      const result = await this.provider.generate({
        prompt: asset.finalGenerationPrompt!,
        aspectRatio: asset.metadata.aspectRatio as '16:9',
        style: asset.metadata.style as string,
      });
      asset.provider = result.provider;
      asset.model = result.model;
      asset.tokenUsage = result.usage;
      asset.metadata = { ...asset.metadata, ...result.metadata };
      key = await this.store(asset, result.image, result.mimeType);
      await this.finish(asset);
    } catch (error) {
      const persisted = await this.assets
        .get(asset.projectId, asset.id)
        .catch(() => undefined);
      if (persisted?.status === 'READY') return;
      if (key && persisted)
        await this.storage.delete(key).catch(() => undefined);
      // Only expose application error messages; SDK errors may contain request details.
      const message =
        error instanceof HttpException
          ? error.message
          : 'Não foi possível salvar ou gerar a imagem. Tente novamente.';
      await this.assets.failed(asset.id, message, asset);
    }
  }
  async upload(
    id: string,
    sceneId: string | null,
    input: unknown,
    file?: ImageUpload,
  ) {
    const request = this.request(input);
    const usageResult = z
      .enum(['REQUIRED', 'REFERENCE', 'OPTIONAL'])
      .safeParse((input as { usage?: unknown })?.usage ?? 'OPTIONAL');
    if (!usageResult.success)
      throw new BadRequestException('Uso da referência inválido.');
    if (!file) throw new BadRequestException('Envie uma imagem no campo file.');
    return this.projects.locked(id, async (p, client) => {
      this.revision(p, request.revision);
      if (sceneId) this.approved(p);
      const scene = sceneId ? this.scene(p, sceneId) : null;
      const asset = this.asset(p, scene, 'USER_UPLOAD', usageResult.data);
      let key: string | undefined;
      try {
        key = await this.store(
          asset,
          file.buffer,
          file.mimetype,
          file.originalname,
        );
        await this.transaction(client, async () => {
          await this.assets.insert(asset, client);
          await this.assets.ready(asset, client);
          if (scene)
            await this.assets.select(
              p.id,
              scene.id,
              asset.id,
              asset.sceneFingerprint!,
              client,
            );
        });
      } catch (error) {
        if (key) await this.storage.delete(key).catch(() => undefined);
        if (error instanceof HttpException) throw error;
        throw new BadRequestException(
          'Não foi possível armazenar a imagem. Tente novamente.',
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
      const scene = this.scene(p, sceneId);
      const asset = await this.assets.get(id, assetId, client);
      if (asset.type !== 'IMAGE' || asset.status !== 'READY')
        throw new ConflictException('A imagem ainda não está pronta.');
      // Same-project references and preserved images from former scenes can be explicitly reused.
      await this.assets.select(
        id,
        sceneId,
        assetId,
        sceneVisualFingerprint(p, scene),
        client,
      );
      return this.state(p, client);
    });
  }
  async file(id: string, assetId: string) {
    await this.projects.get(id);
    const asset = await this.assets.get(id, assetId);
    if (asset.type === 'VIDEO')
      throw new NotFoundException('Use o endpoint de vídeo da renderização.');
    if (asset.status !== 'READY' || !asset.storageKey)
      throw new NotFoundException('Imagem indisponível');
    return {
      image: await this.storage.read(asset.storageKey),
      mimeType: asset.mimeType!,
    };
  }
}
