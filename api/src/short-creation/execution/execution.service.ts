import { mkdir, mkdtemp, rm, statfs, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MediaProcess } from '../../video-render/media-process';
import { RemixVideoValidator } from '../../video-remix/remix-video.validator';
import type { RemixImportSettings } from '../../video-remix/remix-import.settings';
import { editingResourceRegistry } from '../resources/editing-resource.registry';
import {
  inspectResourceEnvironment,
  resourceCapabilities,
} from '../resources/editing-resource.capabilities';
import { prepareGraphics } from '../resources/graphics/graphics-renderer';
import { buildPlanningContext } from '../planning/planning-context';
import { validatePlanningResponse } from '../planning/planning-validator';
import { PlanningValidationError } from '../planning/planning-diagnostics';
import {
  executionInputSchema,
  executionLimitsSchema,
  ExecutionFailure,
  type ExecutionAuthority,
  type ExecutionMetrics,
  type ExecutionPhase,
  type ExecutionResult,
} from './execution.schema';
import { snapshotSource } from './execution-source-resolver';
import {
  preflightVideo,
  preflightAudio,
  preflightImage,
  requireAlignedOriginal,
  type ExecutionBinaries,
} from './execution-preflight';
import {
  compileExecutionVisual,
  compileExecutionGraph,
} from './execution-compiler';
import { validateExecutionOutput } from './execution-output-validator';
let activeExecutions = 0;
export interface ExecutionSettings extends ExecutionBinaries {
  tempDir: string;
  sourceRoot: string;
  timeoutMs?: number;
  outputBytes?: number;
  onPhase?: (phase: ExecutionPhase) => void;
}
/** Internal-only coordinator. No Nest registration, database, job, LLM, TTS or upload. */
export class EditingPlanExecutor {
  constructor(
    readonly process: MediaProcess,
    readonly settings: ExecutionSettings,
  ) {}
  async execute(
    raw: unknown,
    authority: ExecutionAuthority,
    signal?: AbortSignal,
  ): Promise<ExecutionResult> {
    const started = performance.now();
    const children = new Set<Promise<string>>();
    const metrics: ExecutionMetrics = {
      validationMs: 0,
      preflightMs: 0,
      compilationMs: 0,
      graphicsMs: 0,
      renderMs: 0,
      outputValidationMs: 0,
      totalMs: 0,
    };
    let executionId: string | null = null,
      workspace: string | undefined,
      delivered = false,
      phase: ExecutionPhase = 'VALIDATION';
    const base = { version: 1 as const, libraryVersion: 3 as const };
    if (activeExecutions)
      return {
        executionId: null,
        ...base,
        status: 'FAILED',
        metrics,
        diagnostics: [
          {
            level: 'ERROR',
            code: 'EXECUTOR_BUSY',
            message: 'Uma execução isolada já está em andamento.',
          },
        ],
      };
    activeExecutions++;
    const timeoutController = new AbortController();
    const activeSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const limits = executionLimitsSchema.parse({
        ...(this.settings.timeoutMs !== undefined
          ? { timeoutMs: this.settings.timeoutMs }
          : {}),
        ...(this.settings.outputBytes !== undefined
          ? { outputBytes: this.settings.outputBytes }
          : {}),
      });
      timer = setTimeout(() => timeoutController.abort(), limits.timeoutMs);
      const deadline = Date.now() + limits.timeoutMs;
      const scoped = new MediaProcess();
      scoped.run = (binary, args, timeout, _signal, progress) => {
        activeSignal.throwIfAborted();
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          timeoutController.abort();
          activeSignal.throwIfAborted();
        }
        const task = this.process.run(
          binary,
          args,
          Math.min(timeout, remaining),
          activeSignal,
          progress,
        );
        children.add(task);
        void task.then(
          () => children.delete(task),
          () => children.delete(task),
        );
        return task;
      };
      const checkpoint = (next: ExecutionPhase) => {
        phase = next;
        this.settings.onPhase?.(next);
        activeSignal.throwIfAborted();
      };
      checkpoint('VALIDATION');
      if (raw && typeof raw === 'object') {
        const proposed = raw as {
          version?: unknown;
          plan?: { version?: unknown; libraryVersion?: unknown };
        };
        if (
          proposed.version !== 1 ||
          proposed.plan?.version !== 1 ||
          proposed.plan?.libraryVersion !== 3
        )
          throw new ExecutionFailure(
            'VERSION_UNSUPPORTED',
            'Versão de execução, plano ou biblioteca não suportada.',
          );
      }
      const input = executionInputSchema.parse(raw);
      executionId = input.executionId;
      // Structural/editorial rejection happens before even probing executable availability.
      const structuralCapabilities = editingResourceRegistry.map((r) => ({
        id: r.id,
        version: r.version,
        registered: true as const,
        implemented: r.implemented,
        technicallyAvailable: true,
        executionVerified: true,
        available: r.implemented,
        reasons: [],
      }));
      const preliminary = validatePlanningResponse(
        input.plan,
        buildPlanningContext(input.context, {
          authorizedAssetIds: authority.authorizedAssetIds,
          capabilities: structuralCapabilities,
        }),
      );
      if (preliminary.diagnostics.some((d) => d.level === 'ERROR'))
        throw new ExecutionFailure(
          'PLAN_EDITORIAL_INVALID',
          'O plano viola restrições editoriais ou exige revisão.',
        );
      const capabilities = resourceCapabilities(
        await inspectResourceEnvironment(scoped, this.settings, activeSignal),
      );
      activeSignal.throwIfAborted();
      const validated = validatePlanningResponse(
        input.plan,
        buildPlanningContext(input.context, {
          authorizedAssetIds: authority.authorizedAssetIds,
          capabilities,
        }),
      );
      if (validated.diagnostics.some((d) => d.level === 'ERROR'))
        throw new ExecutionFailure(
          'PLAN_INVALID',
          'Plano incompatível com as capacidades disponíveis.',
        );
      const plan = validated.plan,
        context = validated.contextSnapshot;
      metrics.validationMs = performance.now() - started;
      checkpoint('PREFLIGHT');
      let mark = performance.now();
      await mkdir(this.settings.tempDir, { recursive: true, mode: 0o700 });
      const disk = await statfs(this.settings.tempDir);
      if (Number(disk.bavail) * Number(disk.bsize) < 256 * 1024 ** 2)
        throw new ExecutionFailure(
          'INSUFFICIENT_DISK',
          'Espaço temporário insuficiente.',
        );
      workspace = await mkdtemp(join(this.settings.tempDir, 'editing-plan-'));
      const sourceIds = [
        ...new Set([
          ...plan.clips.map((c) => c.sourceId),
          ...plan.audioOperations.flatMap((o) =>
            typeof o.usage.parameters.sourceId === 'string'
              ? [o.usage.parameters.sourceId]
              : [],
          ),
          ...plan.graphicOperations.flatMap((o) =>
            typeof o.usage.parameters.assetId === 'string'
              ? [o.usage.parameters.assetId]
              : [],
          ),
        ]),
      ];
      const snapshots = new Map<
        string,
        Awaited<ReturnType<typeof snapshotSource>>
      >();
      const originals = new Set(
        plan.audioOperations
          .filter((o) => o.usage.resourceId === 'ORIGINAL_AUDIO')
          .map((o) => o.usage.parameters.sourceId),
      );
      const videos = new RemixVideoValidator(
        {
          maxBytes: 512 * 1024 ** 2,
          ffprobePath: this.settings.ffprobePath,
          timeoutMs: 15000,
        } as RemixImportSettings,
        scoped,
      );
      for (const id of sourceIds) {
        activeSignal.throwIfAborted();
        const video = context.videos.find((v) => v.metadata.id === id),
          audio = context.audios.find((a) => a.metadata.id === id),
          image = context.images.find((i) => i.id === id);
        if (!video && !audio && !image)
          throw new ExecutionFailure(
            'SOURCE_UNKNOWN',
            'Plano referencia fonte inexistente.',
          );
        const snapshot = await snapshotSource(
          id,
          this.settings.sourceRoot,
          workspace,
          authority,
          activeSignal,
          video ? 'VIDEO' : audio ? 'AUDIO' : 'IMAGE',
        );
        snapshots.set(id, snapshot);
        if (video) {
          const actual = await preflightVideo(
            scoped,
            this.settings,
            videos,
            snapshot.path,
            video,
            activeSignal,
          );
          if (originals.has(id)) requireAlignedOriginal(actual);
        } else if (audio)
          await preflightAudio(
            scoped,
            this.settings,
            videos,
            snapshot.path,
            audio,
            activeSignal,
          );
        else await preflightImage(snapshot.path, image!, activeSignal);
      }
      metrics.preflightMs = performance.now() - mark;
      checkpoint('COMPILATION');
      mark = performance.now();
      const visual = compileExecutionVisual(plan, context, capabilities);
      metrics.compilationMs = performance.now() - mark;
      checkpoint('GRAPHICS');
      mark = performance.now();
      const graphics = await prepareGraphics(
        plan.graphicOperations.map((o) => o.usage),
        visual.width,
        visual.height,
        visual.expectedDuration,
        workspace,
        async (id) => {
          const found = snapshots.get(id);
          if (!found)
            throw new ExecutionFailure(
              'IMAGE_UNKNOWN',
              'Imagem não autorizada.',
            );
          return found.path;
        },
        activeSignal,
      );
      activeSignal.throwIfAborted();
      metrics.graphicsMs = performance.now() - mark;
      mark = performance.now();
      const compiled = compileExecutionGraph(
        visual,
        graphics.elements,
        plan,
        context,
      );
      metrics.compilationMs += performance.now() - mark;
      checkpoint('RENDER');
      mark = performance.now();
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
      for (const alias of visual.inputIds) {
        const id = plan.clips.find((c) => c.clipId === alias)!.sourceId;
        args.push(
          '-protocol_whitelist',
          'file,pipe',
          '-noautorotate',
          '-t',
          '600',
          '-i',
          snapshots.get(id)!.path,
        );
      }
      for (const g of graphics.elements)
        args.push(
          '-protocol_whitelist',
          'file,pipe',
          '-loop',
          '1',
          '-framerate',
          '30',
          '-t',
          String(visual.expectedDuration),
          '-i',
          g.path,
        );
      for (const id of compiled.additionalAudioIds)
        args.push(
          '-protocol_whitelist',
          'file,pipe',
          '-t',
          '600',
          '-i',
          snapshots.get(id)!.path,
        );
      args.push(
        '-filter_complex',
        compiled.filterGraph,
        '-map',
        `[${compiled.videoLabel}]`,
      );
      if (compiled.audioLabel)
        args.push(
          '-map',
          `[${compiled.audioLabel}]`,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-ac',
          '2',
        );
      else args.push('-an');
      args.push(
        '-sn',
        '-dn',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-t',
        String(visual.expectedDuration),
        '-frames:v',
        String(visual.expectedFrames),
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
        String(limits.outputBytes),
        '-movflags',
        '+faststart',
        '-y',
        output,
      );
      await scoped.run(this.settings.ffmpegPath, args, 120000, activeSignal);
      metrics.renderMs = performance.now() - mark;
      checkpoint('OUTPUT_VALIDATION');
      mark = performance.now();
      const metadata = await validateExecutionOutput(
        scoped,
        this.settings,
        output,
        {
          duration: visual.expectedDuration,
          frames: visual.expectedFrames,
          width: visual.width,
          height: visual.height,
          hasAudio: !!compiled.audioLabel,
          maxBytes: limits.outputBytes,
        },
        activeSignal,
      );
      activeSignal.throwIfAborted();
      metrics.outputValidationMs = performance.now() - mark;
      metrics.totalMs = performance.now() - started;
      const diagnostics = validated.diagnostics.filter(
        (d) =>
          ![
            'EXECUTION_PREFLIGHT_REQUIRED',
            'GRAPHIC_LAYOUT_PREFLIGHT',
          ].includes(d.code),
      );
      diagnostics.push(
        ...graphics.warnings.map((message) => ({
          level: 'WARNING' as const,
          code: 'GRAPHICS_NOTICE',
          message,
        })),
      );
      if (compiled.audio && !compiled.audio.limiter)
        diagnostics.push({
          level: 'WARNING',
          code: 'NO_EXPLICIT_LIMITER',
          message:
            'Sem normalização ou limiter automático; ganhos sobrepostos podem clipar.',
        });
      diagnostics.push({
        level: 'INFO',
        code: 'OUTPUT_VALIDATED',
        message:
          'Arquivo final validado por metadados, frames e decodificação completa. Silêncio, tela escura e congelamento não são rejeitados por heurísticas.',
      });
      for (const name of await readdir(workspace))
        if (name !== 'output.mp4')
          await rm(join(workspace, name), { recursive: true, force: true });
      activeSignal.throwIfAborted();
      const directory = workspace;
      delivered = true;
      return {
        executionId,
        ...base,
        status: 'SUCCESS',
        output: { path: output, ...metadata },
        diagnostics,
        metrics,
        evidence: {
          planVersion: plan.version,
          libraryVersion: plan.libraryVersion,
          narrationMode: context.narration.mode,
          knowledgeStatus: validated.knowledgeStatus,
          plannedDuration: visual.expectedDuration,
          actualDuration: metadata.duration,
          resources: [
            ...new Set(
              [
                ...plan.visualOperations,
                ...plan.graphicOperations,
                ...plan.audioOperations,
              ].map((o) => o.usage.resourceId),
            ),
          ],
          operationCount:
            plan.visualOperations.length +
            plan.graphicOperations.length +
            plan.audioOperations.length,
          sourceCount: snapshots.size,
          sources: [...snapshots.values()].map(({ path, ...s }) => s),
          timeline: validated.visual.spans,
          graphics: {
            elements: graphics.elements.length,
            texturePixels: graphics.texturePixels,
          },
          audio: {
            tracks: compiled.audio?.tracks ?? [],
            limiter: compiled.audio?.limiter ?? false,
          },
          encodings: { video: 1, audio: compiled.audio ? 1 : 0 },
        },
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    } catch (error) {
      const status = signal?.aborted
        ? 'CANCELLED'
        : timeoutController.signal.aborted
          ? 'TIMED_OUT'
          : 'FAILED';
      metrics.totalMs = performance.now() - started;
      const code =
        status === 'CANCELLED'
          ? 'EXECUTION_CANCELLED'
          : status === 'TIMED_OUT'
            ? 'EXECUTION_TIMEOUT'
            : error instanceof ExecutionFailure ||
                error instanceof PlanningValidationError
              ? error.code
              : `${phase}_FAILED`;
      const message =
        status === 'CANCELLED'
          ? 'Execução cancelada; nenhum arquivo parcial foi disponibilizado.'
          : status === 'TIMED_OUT'
            ? 'Tempo limite da execução atingido; nenhum arquivo parcial foi disponibilizado.'
            : error instanceof ExecutionFailure ||
                error instanceof PlanningValidationError
              ? error.message
              : `Não foi possível concluir a etapa ${phase.toLowerCase()}. Revise o plano e os arquivos autorizados.`;
      return {
        executionId,
        ...base,
        status,
        metrics,
        diagnostics: [{ level: 'ERROR', code, message }],
      };
    } finally {
      if (timer) clearTimeout(timer);
      timeoutController.abort();
      await Promise.allSettled([...children]);
      try {
        if (workspace && !delivered)
          await rm(workspace, { recursive: true, force: true });
      } catch {
        metrics.totalMs = performance.now() - started;
        return {
          executionId,
          ...base,
          status: 'FAILED',
          metrics,
          diagnostics: [
            {
              level: 'ERROR',
              code: 'TEMP_CLEANUP_FAILED',
              message:
                'Não foi possível concluir a limpeza do diretório privado; nenhum arquivo foi disponibilizado.',
            },
          ],
        };
      } finally {
        activeExecutions--;
      }
    }
  }
}
