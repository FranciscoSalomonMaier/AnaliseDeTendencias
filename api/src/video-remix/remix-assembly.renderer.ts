import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  mkdir,
  mkdtemp,
  chmod,
  writeFile,
  rm,
  stat,
  statfs,
  readdir,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { VIDEO_FORMATS } from '../video-render/video-formats';
import { MediaProcess } from '../video-render/media-process';
import { filterPath } from '../video-render/ffmpeg.renderer';
import { exportAss } from '../content-subtitles/subtitle.formats';
import {
  validateSegments,
  type SubtitleSegment,
} from '../content-subtitles/subtitle.schema';
import { storyHash } from './remix-story.schema';
import { RemixAssemblyService } from './remix-assembly.service';
import {
  type ExportJob,
  type TimelineRow,
  type AssemblyItem,
} from './remix-assembly.schema';
import { voicedIntervals, pauseAlignedCaptions } from './remix-captions';
const probeSchema = z.object({
  format: z.object({ duration: z.string() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
    }),
  ),
});
export function remixFraming(
  item: AssemblyItem,
  width: number,
  height: number,
) {
  const f = item.framing;
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)*${f.mode === 'MANUAL_CROP' ? f.x : 0.5}:(ih-oh)*${f.mode === 'MANUAL_CROP' ? f.y : 0.5},setsar=1`;
  if (f.mode !== 'BLURRED_BACKGROUND') return `[0:v]${scale}[fit]`;
  return `[0:v]split=2[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=12:2[blur];[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[front];[blur][front]overlay=(W-w)/2:(H-h)/2,setsar=1[fit]`;
}
@Injectable()
export class RemixAssemblyRenderer {
  constructor(
    private readonly service: RemixAssemblyService,
    private readonly process: MediaProcess,
  ) {}
  private probe(path: string, signal: AbortSignal) {
    return this.process
      .run(
        this.service.settings.ffprobePath,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_entries',
          'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate',
          '-of',
          'json',
          path,
        ],
        30000,
        signal,
      )
      .then((v) => probeSchema.parse(JSON.parse(v)));
  }
  private async run(
    args: string[],
    signal: AbortSignal,
    onProgress?: (seconds: number) => void,
  ) {
    return this.process.run(
      this.service.settings.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-threads',
        '1',
        '-filter_complex_threads',
        '1',
        '-filter_threads',
        '1',
        ...args,
      ],
      this.service.settings.timeoutMs,
      signal,
      onProgress,
    );
  }
  async render(
    job: ExportJob,
    t: TimelineRow,
    signal: AbortSignal,
    progress: (stage: string, done: number, total: number) => Promise<void>,
  ) {
    const s = this.service,
      storage = s.story.analyses.files.storage,
      c = t.data.config,
      preview = job.kind === 'PREVIEW',
      width = preview ? 540 : VIDEO_FORMATS[c.aspectRatio].width,
      height = preview ? 960 : VIDEO_FORMATS[c.aspectRatio].height,
      fps = c.fps;
    if (!storage.copyTo || !storage.saveFile)
      throw new Error('Storage não suporta processamento por arquivo.');
    await mkdir(s.settings.tempDir, { recursive: true, mode: 0o700 });
    const disk = await statfs(s.settings.tempDir);
    if (Number(disk.bavail) * Number(disk.bsize) < s.settings.minFreeBytes)
      throw new Error('Espaço livre insuficiente.');
    const dir = await mkdtemp(join(s.settings.tempDir, 'remix-export-'));
    await chmod(dir, 0o700);
    const began = Date.now();
    let peakBytes = 0;
    const check = async () => {
      if (signal.aborted) throw new Error('Cancelado');
      await s.fresh(t);
      const diskNow = await statfs(dir);
      if (
        Number(diskNow.bavail) * Number(diskNow.bsize) <
        Math.min(64 * 1024 * 1024, s.settings.minFreeBytes)
      )
        throw new Error('Espaço livre insuficiente.');
      let bytes = 0;
      for (const name of await readdir(dir)) {
        const info = await stat(join(dir, name));
        bytes += info.size;
      }
      peakBytes = Math.max(peakBytes, bytes);
      if (bytes > s.settings.maxFileBytes * 4)
        throw new Error('Temporários acima do limite.');
    };
    try {
      const filePaths = new Map<string, string>(),
        hasAudio = new Map<string, boolean>();
      for (const id of new Set(t.data.items.map((i) => i.fileId))) {
        await check();
        const f = await s.story.analyses.files.get(job.project_id, id);
        if (Number(f.byte_size) > s.settings.maxFileBytes)
          throw new Error('Fonte acima do limite.');
        const path = join(dir, `source-${filePaths.size}.${f.extension}`);
        await storage.copyTo(f.storage_key, path);
        await chmod(path, 0o600);
        const p = await this.probe(path, signal);
        const v = p.streams.find((x) => x.codec_type === 'video');
        if (
          !v ||
          !Number.isFinite(Number(p.format.duration)) ||
          Math.abs(Number(p.format.duration) - f.duration_seconds) > 0.2 ||
          v.width !== f.width ||
          v.height !== f.height
        )
          throw new Error('Metadados da fonte alterados.');
        hasAudio.set(
          id,
          p.streams.some((x) => x.codec_type === 'audio'),
        );
        filePaths.set(id, path);
      }
      const narrationPaths = new Map<string, string>();
      const captions: SubtitleSegment[] = [];
      for (const [index, segment] of t.data.segments.entries()) {
        await progress('PREPARING_AUDIO', index, t.data.segments.length);
        await check();
        const path = join(dir, `narration-${index}.${segment.audioFormat}`);
        await storage.copyTo(segment.audioKey, path);
        await chmod(path, 0o600);
        const p = await this.probe(path, signal);
        if (
          !p.streams.some((s) => s.codec_type === 'audio') ||
          Math.abs(Number(p.format.duration) - segment.audioDuration) > 0.15
        )
          throw new Error('Narração inválida ou duração alterada.');
        narrationPaths.set(segment.audioId, path);
        if (c.subtitles.enabled && !t.data.subtitleOverrides) {
          const fingerprint = storyHash({
            audio: segment.audioId,
            text: segment.text,
            maxWords: c.subtitles.maxWords,
            maxCharacters: c.subtitles.maxCharacters,
          });
          const cached = await s.db.query<{ cues: SubtitleSegment[] }>(
            'SELECT cues FROM video_remix_caption_alignments WHERE fingerprint=$1 AND project_id=$2',
            [fingerprint, job.project_id],
          );
          let cues = cached.rows[0]?.cues;
          if (!cues) {
            const metadata = await this.run(
              [
                '-i',
                path,
                '-af',
                'silencedetect=noise=-35dB:d=0.15,ametadata=mode=print:file=-',
                '-f',
                'null',
                '-',
              ],
              signal,
            );
            cues = pauseAlignedCaptions(
              segment.text,
              segment.audioDuration,
              voicedIntervals(metadata, segment.audioDuration),
              c.subtitles.maxWords,
              c.subtitles.maxCharacters,
            );
            validateSegments(cues, segment.audioDuration);
            await s.db.query(
              "INSERT INTO video_remix_caption_alignments(fingerprint,project_id,audio_id,cues,method) VALUES($1,$2,$3,$4,'AUDIO_PAUSES_APPROXIMATE') ON CONFLICT DO NOTHING",
              [
                fingerprint,
                job.project_id,
                segment.audioId,
                JSON.stringify(cues),
              ],
            );
          }
          captions.push(
            ...cues.map((cue) => ({
              ...cue,
              id: randomUUID(),
              startSeconds: cue.startSeconds + segment.timelineStart,
              endSeconds: cue.endSeconds + segment.timelineStart,
            })),
          );
        }
      }
      const clips: string[] = [];
      for (const [index, item] of t.data.items.entries()) {
        await check();
        await progress('CUTTING', index, t.data.items.length);
        const audio = hasAudio.get(item.fileId),
          duration = item.duration,
          sourceDuration = item.sourceEnd - item.sourceStart,
          clip = join(dir, `clip-${index}.mp4`),
          frames = Math.max(1, Math.round(duration * fps));
        let visual = `[fit]setpts=(PTS-STARTPTS)/${item.speed},fps=${fps},tpad=stop_mode=clone:stop_duration=${item.freeze + item.roundingPadding + 1 / fps},trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p`;
        if (item.zoom)
          visual += `,zoompan=z='min(1.03,1+0.03*on/${frames})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=${fps}`;
        visual += '[v]';
        const a = `[${audio ? '0:a' : '1:a'}]asetpts=PTS-STARTPTS,atempo=${item.speed},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${duration}[a]`;
        await this.run(
          [
            '-ss',
            String(item.sourceStart),
            '-t',
            String(sourceDuration),
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            filePaths.get(item.fileId)!,
            ...(!audio
              ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
              : []),
            '-filter_complex',
            remixFraming(item, width, height) + ';' + visual + ';' + a,
            '-map',
            '[v]',
            '-map',
            '[a]',
            '-frames:v',
            String(frames),
            '-t',
            String(duration),
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            String(c.quality === 'HIGH' ? 18 : 23),
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-threads',
            '1',
            '-fs',
            String(s.settings.maxFileBytes),
            '-y',
            clip,
          ],
          signal,
        );
        clips.push(clip);
        await progress('CUTTING', index + 1, t.data.items.length);
      }
      const prepared: string[] = [];
      for (const [index, item] of t.data.items.entries()) {
        if (
          item.transition === 'CUT' ||
          (index === clips.length - 1 && item.transition === 'CROSSFADE')
        ) {
          prepared.push(clips[index]);
          continue;
        }
        await progress('TRANSITIONS', index, clips.length);
        const path = join(dir, `effect-${index}.mp4`),
          d = item.transitionSeconds;
        const nextFrame = join(dir, `transition-${index}.png`);
        if (item.transition === 'CROSSFADE')
          await this.run(
            [
              '-i',
              clips[index + 1],
              '-frames:v',
              '1',
              '-update',
              '1',
              '-threads',
              '1',
              '-y',
              nextFrame,
            ],
            signal,
          );
        const filter =
          item.transition === 'FADE'
            ? `[0:v]fade=t=in:st=0:d=${d},fade=t=out:st=${item.duration - d}:d=${d}[v]`
            : `[0:v]fps=${fps}[a];[1:v]fps=${fps},format=yuv420p[b];[a][b]blend=all_expr='A*(1-clip((T-${item.duration - d})/${d},0,1))+B*clip((T-${item.duration - d})/${d},0,1)':shortest=1,trim=duration=${item.duration},fps=${fps}[v]`;
        await this.run(
          [
            '-i',
            clips[index],
            ...(item.transition === 'CROSSFADE'
              ? ['-loop', '1', '-framerate', String(fps), '-i', nextFrame]
              : []),
            '-filter_complex',
            filter,
            '-map',
            '[v]',
            '-map',
            '0:a',
            '-t',
            String(item.duration),
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            String(c.quality === 'HIGH' ? 18 : 23),
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'copy',
            '-threads',
            '1',
            '-fs',
            String(s.settings.maxFileBytes),
            '-y',
            path,
          ],
          signal,
        );
        prepared.push(path);
      }
      const list = join(dir, 'clips.txt');
      await writeFile(
        list,
        prepared
          .map(
            (p, i) =>
              `file '${p.slice(dir.length + 1)}'\nduration ${t.data.items[i].duration}\n`,
          )
          .join(''),
        { mode: 0o600 },
      );
      const joined = join(dir, 'joined.mp4');
      await progress('JOINING', 0, 1);
      await this.run(
        ['-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', '-y', joined],
        signal,
      );
      await check();
      const audioInputs = t.data.segments.flatMap((segment) => [
        '-i',
        narrationPaths.get(segment.audioId)!,
      ]);
      const filters = t.data.segments.map(
        (segment, i) =>
          `[${i + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=duration=${segment.duration}[n${i}]`,
      );
      filters.push(
        t.data.segments.map((_s, i) => `[n${i}]`).join('') +
          `concat=n=${t.data.segments.length}:v=0:a=1,${c.normalize ? 'loudnorm=I=-16:TP=-1.5:LRA=11,' : ''}volume=${c.narrationVolume},apad,atrim=duration=${t.data.duration}[voice]`,
      );
      filters.push(
        `[0:a]volume=${c.originalVolume},apad,atrim=duration=${t.data.duration}[original]`,
      );
      let mix = `[voice][original]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1`;
      if (c.audioFadeSeconds)
        mix += `,afade=t=in:st=0:d=${c.audioFadeSeconds},afade=t=out:st=${Math.max(0, t.data.duration - c.audioFadeSeconds)}:d=${c.audioFadeSeconds}`;
      filters.push(mix + '[audio]');
      let video = `[0:v]fps=${fps},setsar=1`;
      if (c.subtitles.enabled) {
        const cues = t.data.subtitleOverrides ?? captions;
        cues.forEach((cue, i) => (cue.order = i + 1));
        validateSegments(cues, t.data.duration);
        const ass = join(dir, 'captions.ass');
        await writeFile(
          ass,
          exportAss(
            {
              settings: {
                ...c.subtitles,
                preset:
                  c.subtitles.preset === 'DYNAMIC'
                    ? 'BOLD_SHORTS'
                    : c.subtitles.preset,
              },
              versions: [],
              segments: cues.map((cue) => ({
                ...cue,
                sceneId: 'sceneId' in cue ? String(cue.sceneId) : 'manual',
              })),
            },
            width,
            height,
          ),
          { mode: 0o600 },
        );
        const local = resolve(__dirname, '../../assets/fonts'),
          fonts = existsSync(local)
            ? local
            : resolve(__dirname, '../../../assets/fonts');
        video += `,ass=filename='${filterPath(ass)}':fontsdir='${filterPath(fonts)}'`;
      }
      filters.push(video + '[video]');
      const output = join(dir, 'final.mp4');
      await progress('ENCODING', 0, t.data.duration);
      let last = 0;
      await this.run(
        [
          '-i',
          joined,
          ...audioInputs,
          '-filter_complex',
          filters.join(';'),
          '-map',
          '[video]',
          '-map',
          '[audio]',
          '-t',
          String(t.data.duration),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          String(c.quality === 'HIGH' ? 18 : 23),
          '-pix_fmt',
          'yuv420p',
          '-r',
          String(fps),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-movflags',
          '+faststart',
          '-progress',
          'pipe:1',
          '-threads',
          '1',
          '-fs',
          String(s.settings.maxFileBytes),
          '-y',
          output,
        ],
        signal,
        (seconds) => {
          if (seconds - last >= 0.5) {
            last = seconds;
            void progress(
              'ENCODING',
              Math.min(seconds, t.data.duration),
              t.data.duration,
            ).catch(() => {});
          }
        },
      );
      await check();
      const info = await stat(output);
      if (info.size > s.settings.maxFileBytes)
        throw new Error('Arquivo final excede o limite.');
      const p = await this.probe(output, signal),
        v = p.streams.find((x) => x.codec_type === 'video'),
        a = p.streams.find((x) => x.codec_type === 'audio');
      if (
        v?.codec_name !== 'h264' ||
        v.width !== width ||
        v.height !== height ||
        a?.codec_name !== 'aac' ||
        Number(v.avg_frame_rate?.split('/')[0]) /
          Number(v.avg_frame_rate?.split('/')[1]) !==
          fps ||
        Math.abs(Number(p.format.duration) - t.data.duration) > 0.2
      )
        throw new Error('O arquivo final não corresponde à timeline.');
      const key = `remix-export/${job.project_id}/${job.id}.mp4`;
      await s.db.query(
        "INSERT INTO video_remix_storage_cleanup(storage_key,not_before) VALUES($1,NOW()+interval '1 hour') ON CONFLICT DO NOTHING",
        [key],
      );
      await storage.saveFile(key, output);
      return {
        key,
        byteSize: info.size,
        duration: Number(p.format.duration),
        width,
        height,
        metadata: {
          processingMs: Date.now() - began,
          peakTemporaryBytes: peakBytes,
          captionMethod: c.subtitles.enabled
            ? t.data.subtitleOverrides
              ? 'MANUAL'
              : 'AUDIO_PAUSES_APPROXIMATE'
            : 'DISABLED',
          scriptVersion: t.data.scriptVersion,
          scriptRevision: t.data.scriptRevision,
          narrationIds: t.data.segments.map((s) => s.audioId),
          fps,
          videoCodec: 'h264',
          audioCodec: 'aac',
          sourceAudioVolume: c.originalVolume,
        },
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
