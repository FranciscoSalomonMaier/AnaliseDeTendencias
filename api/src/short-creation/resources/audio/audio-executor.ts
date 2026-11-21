import { mkdir, mkdtemp, realpath, stat, statfs, rm } from 'node:fs/promises';
import { isAbsolute, relative, join, sep } from 'node:path';
import { MediaProcess } from '../../../video-render/media-process';
import { RenderSettings } from '../../../video-render/render-settings';
import {
  RemixVideoValidator,
  videoMimes,
} from '../../../video-remix/remix-video.validator';
import {
  audioCompositionSchema,
  parseAudioUsage,
  audioLimits,
  AUDIO_ENGINE_VERSION,
  type AudioSourceMetadata,
} from './audio.schema';
import { ResourceAudioSourceValidator } from './audio-source.validator';
import { compileAudioComposition } from './audio-compiler';
import {
  inspectResourceEnvironment,
  resourceCapabilities,
  resourceCatalog,
} from '../editing-resource.capabilities';
import type { ResourceEnvironment } from '../editing-resource.types';
import { RESOURCE_LIBRARY_VERSION } from '../editing-resource.schema';
/** Internal lookup must enforce ownership/usage rights before returning a path. No controller/job integration. */
export class AudioResourceExecutor {
  private running = false;
  private environment?: Promise<ResourceEnvironment>;
  constructor(
    readonly process: MediaProcess,
    readonly videos: RemixVideoValidator,
    readonly settings: Pick<
      RenderSettings,
      'ffmpegPath' | 'ffprobePath' | 'tempDir'
    >,
    readonly sourceRoot: string,
  ) {}
  async capabilities() {
    if (!this.environment)
      this.environment = inspectResourceEnvironment(
        this.process,
        this.settings,
      );
    return resourceCapabilities(await this.environment);
  }
  async catalog() {
    await this.capabilities();
    return resourceCatalog(await this.environment!, false);
  }
  async execute(
    raw: unknown,
    lookup: (id: string) => Promise<string>,
    signal?: AbortSignal,
  ) {
    if (this.running)
      throw Error('Já existe uma execução de áudio em andamento.');
    const plan = audioCompositionSchema.parse(raw),
      usages = plan.operations.map(parseAudioUsage);
    this.running = true;
    let workspace: string | undefined,
      delivered = false;
    const deadline = Date.now() + audioLimits.timeoutMs;
    const timeoutController = new AbortController(),
      timer = setTimeout(
        () => timeoutController.abort(),
        audioLimits.timeoutMs,
      );
    const activeSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
    try {
      const scoped = new MediaProcess();
      scoped.run = (binary, args, timeout, _signal, progress) => {
        const remaining = deadline - Date.now();
        if (activeSignal.aborted) throw Error('Execução cancelada.');
        if (remaining <= 0) throw Error('Timeout da composição de áudio.');
        return this.process.run(
          binary,
          args,
          Math.min(timeout, remaining),
          activeSignal,
          progress,
        );
      };
      const capabilities = await this.capabilities();
      for (const u of usages)
        if (!capabilities.some((c) => c.id === u.resourceId && c.available))
          throw Error('Recurso de áudio indisponível.');
      if (activeSignal.aborted) throw Error('Execução cancelada.');
      const root = await realpath(this.sourceRoot),
        paths = new Map<string, string>(),
        sources: AudioSourceMetadata[] = [];
      const ids = [
        ...new Set([
          ...usages.flatMap((u) =>
            'sourceId' in u.parameters ? [u.parameters.sourceId] : [],
          ),
          ...(plan.videoSourceId ? [plan.videoSourceId] : []),
        ]),
      ];
      if (ids.length > 8) throw Error('Mais de oito origens autorizadas.');
      for (const id of ids) {
        const path = await realpath(await lookup(id)),
          inside = relative(root, path);
        if (
          !inside ||
          inside === '..' ||
          inside.startsWith('..' + sep) ||
          isAbsolute(inside)
        )
          throw Error('Fonte fora da raiz autorizada.');
        paths.set(id, path);
      }
      const validator = new ResourceAudioSourceValidator(
        scoped,
        this.settings,
        this.videos,
      );
      for (const id of ids) {
        const uses = usages.filter(
          (u) => 'sourceId' in u.parameters && u.parameters.sourceId === id,
        );
        if (!uses.length) continue;
        const original = uses.some((u) => u.resourceId === 'ORIGINAL_AUDIO');
        if (original && uses.some((u) => u.resourceId !== 'ORIGINAL_AUDIO'))
          throw Error(
            'Fonte de vídeo não pode ser implicitamente tratada como áudio independente.',
          );
        sources.push(
          await validator.validate(
            id,
            paths.get(id)!,
            original ? 'VIDEO' : 'AUDIO',
            activeSignal,
          ),
        );
      }
      let video:
        Awaited<ReturnType<RemixVideoValidator['validate']>> | undefined;
      if (plan.videoSourceId) {
        const path = paths.get(plan.videoSourceId)!,
          file = await stat(path),
          ext = path.split('.').at(-1)!.toLowerCase();
        if (file.size > audioLimits.videoBytes || !videoMimes[ext])
          throw Error('Vídeo de destino inválido.');
        video = await this.videos.validate(
          {
            path,
            originalname: 'video.' + ext,
            mimetype: videoMimes[ext][0],
            size: file.size,
          },
          activeSignal,
        );
        if (
          video.codec !== 'h264' ||
          Math.abs(video.durationSeconds - plan.duration) > 1 / 30
        )
          throw Error(
            'O vídeo H.264 deve ter a duração explícita da composição.',
          );
      }
      const compiled = compileAudioComposition(plan, sources);
      await mkdir(this.settings.tempDir, { recursive: true, mode: 0o700 });
      const disk = await statfs(this.settings.tempDir);
      if (Number(disk.bavail) * Number(disk.bsize) < 256 * 1024 ** 2)
        throw Error('Espaço temporário insuficiente.');
      workspace = await mkdtemp(join(this.settings.tempDir, 'audio-resource-'));
      const output = join(workspace, video ? 'output.mp4' : 'output.wav'),
        args = [
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
        args.push('-protocol_whitelist', 'file,pipe', '-i', paths.get(id)!);
      if (video)
        args.push(
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          paths.get(plan.videoSourceId!)!,
        );
      if (plan.silentOutput !== 'NO_STREAM')
        args.push('-filter_complex', compiled.filterGraph);
      if (video)
        args.push('-map', `${compiled.inputIds.length}:v:0`, '-c:v', 'copy');
      if (plan.silentOutput === 'NO_STREAM') args.push('-an');
      else
        args.push(
          '-map',
          `[${compiled.outputLabel}]`,
          '-c:a',
          video ? 'aac' : 'pcm_s16le',
          '-ar',
          '48000',
          '-ac',
          '2',
          ...(video ? ['-b:a', '192k'] : []),
        );
      args.push(
        '-sn',
        '-dn',
        '-t',
        String(compiled.duration),
        '-fs',
        String(audioLimits.outputBytes),
        ...(video ? ['-movflags', '+faststart'] : []),
        '-y',
        output,
      );
      await scoped.run(this.settings.ffmpegPath, args, 120000, activeSignal);
      const bytes = (await stat(output)).size;
      if (!bytes || bytes > audioLimits.outputBytes)
        throw Error('Saída vazia ou acima do limite.');
      const probe = JSON.parse(
        await scoped.run(
          this.settings.ffprobePath,
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration:stream=codec_type,codec_name,sample_rate,channels',
            '-of',
            'json',
            output,
          ],
          10000,
          activeSignal,
        ),
      );
      const audio =
        probe.streams?.filter((s) => s.codec_type === 'audio') ?? [];
      if (
        !Number.isFinite(Number(probe.format?.duration)) ||
        Math.abs(Number(probe.format.duration) - compiled.duration) >
          (video ? 1 / 30 : 1 / 48000)
      )
        throw Error('Duração final do áudio divergente.');
      if (
        plan.silentOutput === 'NO_STREAM'
          ? audio.length !== 0
          : audio.length !== 1 ||
            Number(audio[0]?.sample_rate) !== 48000 ||
            audio[0]?.channels !== 2 ||
            audio[0]?.codec_name !== (video ? 'aac' : 'pcm_s16le')
      )
        throw Error('Formato da saída divergente.');
      delivered = true;
      const directory = workspace;
      return {
        path: output,
        bytes,
        duration: compiled.duration,
        sampleRate: plan.silentOutput === 'NO_STREAM' ? null : 48000,
        channels: plan.silentOutput === 'NO_STREAM' ? 0 : 2,
        format: video ? 'MP4' : 'WAV',
        libraryVersion: RESOURCE_LIBRARY_VERSION,
        audioEngineVersion: AUDIO_ENGINE_VERSION,
        tracks: compiled.tracks,
        impacts: compiled.impacts,
        protection: compiled.limiter ? 'EXPLICIT_LIMITER' : 'NONE',
        warnings: compiled.limiter
          ? []
          : [
              'Sem normalização automática: ganhos somados podem clipar. Configure AUDIO_MIX.limiter quando necessário.',
            ],
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    } finally {
      clearTimeout(timer);
      this.running = false;
      if (workspace && !delivered)
        await rm(workspace, { recursive: true, force: true });
    }
  }
}
