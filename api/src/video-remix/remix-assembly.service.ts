import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RemixStoryService } from './remix-story.service';
import { storyHash } from './remix-story.schema';
import {
  buildRemixTimeline,
  type AssemblyInput,
} from './remix-timeline.builder';
import {
  assemblyConfigSchema,
  cutEditSchema,
  type TimelineRow,
  type AssemblyData,
} from './remix-assembly.schema';
import {
  SubtitleSegmentSchema,
  validateSegments,
  type SubtitleSegment,
} from '../content-subtitles/subtitle.schema';
import { RenderSettings } from '../video-render/render-settings';
@Injectable()
export class RemixAssemblyService {
  constructor(
    readonly story: RemixStoryService,
    readonly settings: RenderSettings,
  ) {}
  get db() {
    return this.story.db;
  }
  async input(project: string, scriptId: string): Promise<AssemblyInput> {
    const s = await this.story.script(project, scriptId);
    await this.story.current(s);
    const segments = await this.story.segments(scriptId);
    if (
      !segments.length ||
      segments.some(
        (x) => x.validation.status !== 'SUPPORTED' || !x.narration_id,
      )
    )
      throw new BadRequestException(
        'Valide todos os segmentos e gere a narração segmentada antes de montar o vídeo.',
      );
    const rows: AssemblyInput['segments'] = [];
    for (const segment of segments) {
      const r = await this.db.query<{
        id: string;
        storage_key: string;
        format: string;
        byte_size: number;
        duration_seconds: number;
        fingerprint: string;
      }>('SELECT * FROM video_remix_narrations WHERE project_id=$1 AND id=$2', [
        project,
        segment.narration_id,
      ]);
      const audio = r.rows[0];
      if (
        !audio ||
        audio.fingerprint !==
          this.story.voice.fingerprint(segment.text, s.config) ||
        (
          await this.story.analyses.files.storage
            .stat?.(audio.storage_key)
            .catch(() => null)
        )?.size !== audio.byte_size
      )
        throw new BadRequestException(
          'Narração ausente ou desatualizada. Gere novamente o áudio.',
        );
      rows.push({
        id: segment.id,
        text: segment.text,
        audioId: audio.id,
        audioKey: audio.storage_key,
        audioFormat: audio.format,
        audioBytes: audio.byte_size,
        audioDuration: audio.duration_seconds,
        refs: s.context_snapshot.evidence.filter((e) =>
          segment.candidate_ids.includes(e.id),
        ),
      });
    }
    return {
      scriptId: s.id,
      scriptVersion: s.version,
      scriptRevision: s.revision,
      contextHash: s.context_hash,
      targetDuration: s.config.targetDuration,
      segments: rows,
    };
  }
  async row(project: string, id: string) {
    await this.story.analyses.authorize(project);
    const r = await this.db.query<TimelineRow>(
      'SELECT * FROM video_remix_timelines WHERE project_id=$1 AND id=$2',
      [project, id],
    );
    if (!r.rows[0]) throw new NotFoundException('Timeline não encontrada.');
    return r.rows[0];
  }
  async fresh(t: TimelineRow) {
    const current = await this.input(t.project_id, t.script_id).catch(
      (error) => {
        if (
          error instanceof BadRequestException ||
          error instanceof ConflictException
        )
          throw new ConflictException(
            'Fontes, autorizações, roteiro ou narração mudaram. Revise o projeto e crie uma nova timeline.',
          );
        throw error;
      },
    );
    if (
      current.scriptRevision !== t.data.scriptRevision ||
      current.contextHash !== t.data.contextHash ||
      storyHash(current.segments.map((s) => s.audioId)) !==
        storyHash(
          [...t.data.segments]
            .sort(
              (a, b) =>
                current.segments.findIndex((x) => x.id === a.id) -
                current.segments.findIndex((x) => x.id === b.id),
            )
            .map((s) => s.audioId),
        )
    )
      throw new ConflictException(
        'A timeline usa uma versão anterior do roteiro ou áudio. Crie uma nova timeline.',
      );
    return current;
  }
  dto(t: TimelineRow, stale = false) {
    return {
      id: t.id,
      projectId: t.project_id,
      version: t.version,
      createdAt: t.created_at,
      stale,
      data: {
        ...t.data,
        segments: t.data.segments.map(({ audioKey, ...s }) => ({
          ...s,
          audioAvailable: Boolean(audioKey),
        })),
      },
    };
  }
  async get(project: string, id: string) {
    const t = await this.row(project, id);
    let stale = false;
    try {
      await this.fresh(t);
    } catch {
      stale = true;
    }
    const captions: SubtitleSegment[] = [];
    for (const s of t.data.segments) {
      const key = storyHash({
        audio: s.audioId,
        text: s.text,
        maxWords: t.data.config.subtitles.maxWords,
        maxCharacters: t.data.config.subtitles.maxCharacters,
      });
      const r = await this.db.query<{
        cues: Array<{ text: string; startSeconds: number; endSeconds: number }>;
      }>(
        'SELECT cues FROM video_remix_caption_alignments WHERE project_id=$1 AND fingerprint=$2',
        [project, key],
      );
      if (r.rows[0])
        captions.push(
          ...r.rows[0].cues.map((c, i) => ({
            ...c,
            id: randomUUID(),
            order: i + 1,
            sceneId: s.id,
            startSeconds: c.startSeconds + s.timelineStart,
            endSeconds: c.endSeconds + s.timelineStart,
          })),
        );
    }
    captions.forEach((c, i) => (c.order = i + 1));
    return {
      ...this.dto(t, stale),
      captions: t.data.subtitleOverrides ?? captions,
      captionMethod: t.data.subtitleOverrides
        ? 'MANUAL'
        : 'AUDIO_PAUSES_APPROXIMATE',
    };
  }
  async list(project: string) {
    await this.story.analyses.authorize(project);
    return {
      items: (
        await this.db.query(
          'SELECT id,version,created_at FROM video_remix_timelines WHERE project_id=$1 ORDER BY version DESC LIMIT 100',
          [project],
        )
      ).rows,
    };
  }
  async persist(project: string, data: AssemblyData) {
    if (
      data.items.length > 36 ||
      new Set(data.items.map((i) => i.id)).size !== data.items.length
    )
      throw new BadRequestException('Use até 36 cortes com IDs distintos.');
    if (data.duration > Math.min(600, this.settings.maxDurationSeconds))
      throw new BadRequestException('Timeline excede o limite de duração.');
    return this.db.withClient(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          'SELECT id FROM video_remix_projects WHERE id=$1 FOR UPDATE',
          [project],
        );
        const version = (
          await db.query<{ version: number }>(
            'SELECT COALESCE(MAX(version),0)+1 version FROM video_remix_timelines WHERE project_id=$1',
            [project],
          )
        ).rows[0].version;
        const id = randomUUID();
        await db.query(
          'INSERT INTO video_remix_timelines(id,project_id,script_id,version,fingerprint,data) VALUES($1,$2,$3,$4,$5,$6)',
          [id, project, data.scriptId, version, storyHash(data), data],
        );
        await db.query('COMMIT');
        return this.get(project, id);
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    });
  }
  async create(project: string, raw: unknown) {
    const r = z
      .object({ scriptId: z.uuid(), config: assemblyConfigSchema })
      .strict()
      .safeParse(raw);
    if (!r.success)
      throw new BadRequestException('Configuração de montagem inválida.');
    return this.persist(
      project,
      buildRemixTimeline(
        await this.input(project, r.data.scriptId),
        r.data.config,
      ),
    );
  }
  async update(project: string, id: string, raw: unknown) {
    const r = z
      .object({
        items: z.array(cutEditSchema).max(36),
        config: assemblyConfigSchema,
        subtitles: z
          .array(SubtitleSegmentSchema)
          .max(1000)
          .nullable()
          .optional(),
      })
      .strict()
      .safeParse(raw);
    if (!r.success)
      throw new BadRequestException('Cortes ou configurações inválidos.');
    const previous = await this.row(project, id),
      input = await this.fresh(previous);
    const data = buildRemixTimeline(input, r.data.config, r.data.items);
    if (r.data.subtitles?.length) {
      try {
        validateSegments(r.data.subtitles, data.duration);
      } catch {
        throw new BadRequestException(
          'Timestamps/textos das legendas inválidos.',
        );
      }
      data.subtitleOverrides = r.data.subtitles;
    }
    return this.persist(project, data);
  }
  async request(project: string, id: string, raw: unknown) {
    const parsed = z
      .object({
        kind: z.enum(['PREVIEW', 'FINAL']),
        confirm: z.literal(true),
        confirmApproximateSubtitles: z.boolean().default(false),
      })
      .strict()
      .safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException('Confirme o tipo de renderização.');
    const t = await this.row(project, id);
    await this.fresh(t);
    if (t.data.issues.length)
      throw new BadRequestException(t.data.issues.join(' '));
    if (
      parsed.data.kind === 'FINAL' &&
      t.data.config.subtitles.enabled &&
      !t.data.subtitleOverrides &&
      !parsed.data.confirmApproximateSubtitles
    )
      throw new BadRequestException(
        'Gere uma prévia, revise as legendas aproximadas e confirme a revisão antes de exportar.',
      );
    if (
      parsed.data.kind === 'FINAL' &&
      t.data.config.subtitles.enabled &&
      !t.data.subtitleOverrides
    ) {
      const preview = await this.db.query(
        "SELECT 1 FROM video_remix_exports WHERE project_id=$1 AND timeline_id=$2 AND kind='PREVIEW' AND status='COMPLETED' LIMIT 1",
        [project, id],
      );
      if (!preview.rowCount)
        throw new BadRequestException(
          'Gere e revise uma prévia desta versão antes de exportar com legendas aproximadas.',
        );
    }
    const fp = storyHash({ timeline: t.fingerprint, kind: parsed.data.kind });
    return this.db.withClient(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('remix-export-enqueue',0))",
        );
        const prior = await db.query<{ id: string; status: string }>(
          "SELECT id,status FROM video_remix_exports WHERE project_id=$1 AND fingerprint=$2 AND status IN ('QUEUED','RUNNING')",
          [project, fp],
        );
        if (prior.rows[0]) {
          await db.query('COMMIT');
          return prior.rows[0];
        }
        const q = await db.query<{ count: string }>(
          "SELECT count(*) FROM video_remix_exports WHERE status IN ('QUEUED','RUNNING')",
        );
        if (Number(q.rows[0].count) >= this.settings.maxQueued)
          throw new ConflictException('Fila de renderização cheia.');
        const result = randomUUID();
        await db.query(
          "INSERT INTO video_remix_exports(id,project_id,timeline_id,kind,status,fingerprint,options) VALUES($1,$2,$3,$4,'QUEUED',$5,$6)",
          [
            result,
            project,
            id,
            parsed.data.kind,
            fp,
            {
              confirmApproximateSubtitles:
                parsed.data.confirmApproximateSubtitles,
            },
          ],
        );
        await db.query('COMMIT');
        return { id: result, status: 'QUEUED' };
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    });
  }
  async renders(project: string) {
    await this.story.analyses.authorize(project);
    return {
      items: (
        await this.db.query(
          'SELECT id,timeline_id,kind,status,progress,byte_size,duration_seconds,width,height,metadata,error_message,attempts,created_at,started_at,completed_at FROM video_remix_exports WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',
          [project],
        )
      ).rows,
    };
  }
  async cancel(project: string, id: string) {
    await this.story.analyses.authorize(project);
    await this.db.query(
      "UPDATE video_remix_exports SET cancel_requested=true,status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END WHERE id=$1 AND project_id=$2 AND status IN ('QUEUED','RUNNING')",
      [id, project],
    );
    return { ok: true };
  }
  async media(project: string, id: string) {
    await this.story.analyses.authorize(project);
    const r = await this.db.query<{
      timeline_id: string;
      storage_key: string;
      byte_size: string;
    }>(
      "SELECT timeline_id,storage_key,byte_size FROM video_remix_exports WHERE project_id=$1 AND id=$2 AND status='COMPLETED'",
      [project, id],
    );
    if (!r.rows[0])
      throw new NotFoundException('Vídeo renderizado indisponível.');
    const f = r.rows[0];
    await this.fresh(await this.row(project, f.timeline_id));
    const storage = this.story.analyses.files.storage;
    if (
      !storage.openRead ||
      (await storage.stat?.(f.storage_key))?.size !== Number(f.byte_size)
    )
      throw new NotFoundException('Vídeo não encontrado no storage.');
    return {
      size: Number(f.byte_size),
      open: (a?: number, b?: number) => storage.openRead!(f.storage_key, a, b),
    };
  }
}
