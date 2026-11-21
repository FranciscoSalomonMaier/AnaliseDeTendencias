import { isAudioId } from './audio/audio.schema';
import { isGraphicsId } from './graphics/graphics.schema';
import {
  parseGraphicsUsage,
  prepareGraphics,
  graphicsAssetIds,
} from './graphics/graphics-renderer';
import { appendGraphicsGraph } from './graphics/graphics-animation';
import { RESOURCE_LIBRARY_VERSION } from './editing-resource.schema';
import { mkdir, mkdtemp, realpath, rm, stat, statfs } from 'node:fs/promises';
import { extname, join, relative, isAbsolute } from 'node:path';
import { MediaProcess } from '../../video-render/media-process';
import { RenderSettings } from '../../video-render/render-settings';
import {
  RemixVideoValidator,
  videoMimes,
} from '../../video-remix/remix-video.validator';
import {
  resourceCompositionSchema,
  resourceUsageSchema,
  type ResourceAssetMetadata,
  type ResourceCanvas,
} from './editing-resource.schema';
import { compileResourceComposition } from './editing-resource.compiler';
import {
  inspectResourceEnvironment,
  resourceCapabilities,
  resourceCatalog,
} from './editing-resource.capabilities';
import { validateResourceUsage } from './editing-resource.validator';
import type { ResourceEnvironment } from './editing-resource.types';
/** Internal, authorized asset lookup. Never deserialize paths from a resource request.
 * An integration must resolve IDs only after verifying project ownership and use rights. */
export type ResourceAssetLookup = (id: string) => Promise<string>;
export class EditingResourceExecutor {
  private running = false;
  private environment?: Promise<ResourceEnvironment>;
  constructor(
    readonly process: MediaProcess,
    readonly validator: RemixVideoValidator,
    readonly settings: Pick<
      RenderSettings,
      'ffmpegPath' | 'ffprobePath' | 'tempDir'
    >,
    readonly sourceRoot: string,
  ) {}
  async capabilities(refresh = false) {
    if (!this.environment || refresh)
      this.environment = inspectResourceEnvironment(
        this.process,
        this.settings,
      );
    return resourceCapabilities(await this.environment);
  }
  async catalog(availableOnly = true) {
    if (!this.environment) await this.capabilities();
    return resourceCatalog(await this.environment!, availableOnly);
  }
  async execute(
    raw: unknown,
    lookup: ResourceAssetLookup,
    canvas: Partial<ResourceCanvas> = {},
    signal?: AbortSignal,
  ) {
    const usage = resourceUsageSchema.parse(raw);
    return this.executeComposition(
      { contractVersion: 1, operations: [usage] },
      lookup,
      canvas,
      signal,
    );
  }
  async executeComposition(
    raw: unknown,
    lookup: ResourceAssetLookup,
    canvas: Partial<ResourceCanvas> = {},
    signal?: AbortSignal,
  ) {
    if (this.running)
      throw Error('Já há uma execução local de recursos em andamento.');
    const request = resourceCompositionSchema.parse(raw);
    if (request.operations.some((u) => isAudioId(u.resourceId)))
      throw Error('Utilize AudioResourceExecutor para operações sonoras.');
    this.running = true;
    let workspace: string | undefined,
      delivered = false;
    try {
      if (signal?.aborted) throw Error('Execução cancelada.');
      const capabilities = await this.capabilities();
      const graphical = request.operations.filter((u) =>
        isGraphicsId(u.resourceId),
      );
      const visual = request.operations.filter(
        (u) => !isGraphicsId(u.resourceId),
      );
      request.operations.forEach((usage) => {
        if (isGraphicsId(usage.resourceId)) {
          if (
            !capabilities.some((c) => c.id === usage.resourceId && c.available)
          )
            throw Error('Recurso gráfico indisponível.');
          parseGraphicsUsage(usage);
        } else validateResourceUsage(usage, capabilities);
      });
      if (!visual.length) {
        const target = graphical[0].target;
        if (target.scope !== 'COMPOSITION' || !target.clipId)
          throw Error('Composição gráfica inválida.');
        visual.push({
          contractVersion: 1,
          resourceId: 'FIT',
          resourceVersion: 1,
          target,
          parameters: {},
        });
      }
      const visualRequest = { contractVersion: 1, operations: visual };
      const ids = [
        ...new Set(
          visual.flatMap(({ target: t }) =>
            t.scope === 'SOURCE_INTERVAL'
              ? [t.sourceId]
              : t.scope === 'BETWEEN_CLIPS'
                ? [t.fromClipId, t.toClipId]
                : t.scope === 'COMPOSITION'
                  ? (t.clipIds ?? [t.clipId!])
                  : [t.clipId],
          ),
        ),
      ];
      if (ids.length > 8)
        throw Error('A composição local aceita até oito origens.');
      const imageIds = graphicsAssetIds(graphical);
      if (new Set([...ids, ...imageIds]).size > 8)
        throw Error('A composição aceita até oito origens de vídeo e imagem.');
      const root = await realpath(this.sourceRoot),
        assets: ResourceAssetMetadata[] = [],
        paths = new Map<string, string>();
      for (const id of ids) {
        const path = await realpath(await lookup(id)),
          inside = relative(root, path);
        if (
          !inside ||
          inside === '..' ||
          inside.startsWith('..' + requireSeparator()) ||
          isAbsolute(inside)
        )
          throw Error('Arquivo fora da raiz autorizada.');
        const file = await stat(path);
        if (!file.isFile() || !file.size || file.size > 512 * 1024 ** 2)
          throw Error('Origem ausente ou acima de 512 MB.');
        const extension = extname(path).slice(1).toLowerCase(),
          mimetype = videoMimes[extension]?.[0];
        if (!mimetype) throw Error('Formato de origem incompatível.');
        const metadata = await this.validator.validate(
          {
            path,
            originalname: 'source.' + extension,
            mimetype,
            size: file.size,
          },
          signal,
        );
        assets.push({
          id,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          duration: metadata.durationSeconds,
        });
        paths.set(id, path);
      }
      const compiled = compileResourceComposition(
        visualRequest,
        assets,
        capabilities,
        canvas,
      );
      if (
        graphical.some(
          (u) =>
            u.target.scope !== 'COMPOSITION' ||
            u.target.clipId !== compiled.outputClipId,
        )
      )
        throw Error(
          'Gráficos devem referenciar o trecho sobrevivente da composição final.',
        );
      await mkdir(this.settings.tempDir, { recursive: true, mode: 0o700 });
      const disk = await statfs(this.settings.tempDir);
      if (Number(disk.bavail) * Number(disk.bsize) < 256 * 1024 ** 2)
        throw Error('Espaço temporário insuficiente.');
      workspace = await mkdtemp(join(this.settings.tempDir, 'resource-'));
      const prepared = await prepareGraphics(
        graphical,
        compiled.width,
        compiled.height,
        compiled.expectedDuration,
        workspace,
        async (id) => {
          const path = await realpath(await lookup(id)),
            inside = relative(root, path);
          if (
            !inside ||
            inside === '..' ||
            inside.startsWith('..' + requireSeparator()) ||
            isAbsolute(inside)
          )
            throw Error('Imagem fora da raiz autorizada.');
          return path;
        },
        signal,
      );
      const finalGraph = appendGraphicsGraph(compiled, prepared.elements);
      const output = join(workspace, 'output.mp4');
      const args = [
        '-hide_banner',
        '-v',
        'error',
        '-nostdin',
        '-threads',
        '1',
        '-filter_complex_threads',
        '1',
        '-filter_threads',
        '1',
      ];
      for (const id of compiled.inputIds)
        args.push(
          '-protocol_whitelist',
          'file,pipe',
          '-noautorotate',
          '-t',
          '600',
          '-i',
          paths.get(id)!,
        );
      for (const e of prepared.elements)
        args.push(
          '-protocol_whitelist',
          'file,pipe',
          '-loop',
          '1',
          '-framerate',
          '30',
          '-t',
          String(compiled.expectedDuration),
          '-i',
          e.path,
        );
      args.push(
        '-filter_complex',
        finalGraph.filterGraph,
        '-map',
        `[${finalGraph.outputLabel}]`,
        '-an',
        '-sn',
        '-dn',
        '-t',
        compiled.expectedDuration.toFixed(6),
        '-frames:v',
        String(compiled.expectedFrames),
        '-r',
        '30',
        '-fps_mode',
        'cfr',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '1',
        '-fs',
        String(128 * 1024 ** 2),
        '-movflags',
        '+faststart',
        '-y',
        output,
      );
      await this.process.run(this.settings.ffmpegPath, args, 120000, signal);
      const size = (await stat(output)).size;
      if (!size || size > 128 * 1024 ** 2)
        throw Error('Saída visual vazia ou acima do limite.');
      const metadata = await this.validator.validate(
        {
          path: output,
          originalname: 'output.mp4',
          mimetype: 'video/mp4',
          size,
        },
        signal,
      );
      if (
        metadata.codec !== 'h264' ||
        metadata.width !== compiled.width ||
        metadata.height !== compiled.height ||
        Math.abs(metadata.fps - 30) > 0.01 ||
        Math.abs(metadata.durationSeconds - compiled.expectedDuration) >
          0.5 / 30
      )
        throw Error(
          'Resultado visual incompatível com o contrato de duração ou composição.',
        );
      delivered = true;
      const directory = workspace;
      return {
        path: output,
        bytes: size,
        duration: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        libraryVersion: RESOURCE_LIBRARY_VERSION,
        graphics: {
          elements: prepared.elements.length,
          warnings: prepared.warnings,
          texturePixels: prepared.texturePixels,
        },
        contractVersion: 1,
        impacts: compiled.impacts,
        audio: 'NONE' as const,
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    } finally {
      this.running = false;
      if (workspace && !delivered)
        await rm(workspace, { recursive: true, force: true });
    }
  }
}
function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}
