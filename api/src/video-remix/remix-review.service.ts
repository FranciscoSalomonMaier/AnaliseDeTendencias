import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RemixAssemblyService } from './remix-assembly.service';
import { storyHash } from './remix-story.schema';
import {
  EXPORT_PRESETS,
  platformSchema,
  customExportSchema,
  exportPreset,
  reviewSchema,
  metadataSchema,
  safeExportName,
  type ReviewRender,
  type ExportPreset,
  type Delivery,
} from './remix-review.schema';
@Injectable()
export class RemixReviewService {
  constructor(readonly assembly: RemixAssemblyService) {}
  get db() {
    return this.assembly.db;
  }
  get storage() {
    return this.assembly.story.analyses.files.storage;
  }
  async event(
    project: string,
    action: string,
    id: string,
    details: object = {},
  ) {
    await this.db.query(
      'INSERT INTO video_remix_review_events(project_id,action,subject_id,details) VALUES($1,$2,$3,$4)',
      [project, action, id, details],
    );
  }
  async render(project: string, id: string) {
    await this.assembly.story.analyses.authorize(project);
    const r = await this.db.query<ReviewRender>(
      'SELECT r.*,p.title project_title,p.mode project_mode,p.topic,p.narration_language FROM video_remix_exports r JOIN video_remix_projects p ON p.id=r.project_id WHERE r.id=$1 AND r.project_id=$2',
      [id, project],
    );
    if (!r.rows[0]) throw new NotFoundException('Renderização não encontrada.');
    return r.rows[0];
  }
  async detail(project: string, id: string) {
    const r = await this.render(project, id),
      timeline = await this.assembly.get(project, r.timeline_id);
    const review =
      (
        await this.db.query(
          'SELECT id,ratings,notes,revision,updated_at FROM video_remix_reviews WHERE project_id=$1 AND render_id=$2',
          [project, id],
        )
      ).rows[0] ?? null;
    const sources = (await this.assembly.story.analyses.repo.sources(project))
      .filter((s) => timeline.data.items.some((i) => i.sourceId === s.id))
      .map((s) => ({ id: s.id, title: s.title }));
    return { render: this.dto(r, timeline.data), timeline, review, sources };
  }
  dto(
    r: ReviewRender,
    data?: {
      items: Array<{ sourceId: string }>;
      config: unknown;
      manualAdjustments?: number;
      warnings: string[];
      scriptVersion: number;
      scriptRevision: number;
    },
  ) {
    return {
      id: r.id,
      projectId: r.project_id,
      title:
        typeof r.metadata.title === 'string'
          ? r.metadata.title
          : r.project_title,
      mode: r.metadata.mode ?? r.project_mode,
      version: r.version,
      kind: r.kind,
      status: r.status,
      width: r.width,
      height: r.height,
      fps: r.metadata.fps ?? null,
      duration: r.duration_seconds,
      byteSize: Number(r.byte_size ?? 0),
      createdAt: r.created_at,
      completedAt: r.completed_at,
      progress: r.progress,
      error: r.error_message,
      timelineId: r.timeline_id,
      processingMs: r.metadata.processingMs ?? null,
      captionMethod: r.metadata.captionMethod ?? null,
      ...(data
        ? {
            sourceCount: new Set(data.items.map((i) => i.sourceId)).size,
            cutCount: data.items.length,
            config: data.config,
            manualAdjustments: data.manualAdjustments ?? null,
            warnings: data.warnings,
            scriptVersion: data.scriptVersion,
            scriptRevision: data.scriptRevision,
          }
        : {}),
    };
  }
  async list(project: string) {
    await this.assembly.story.analyses.authorize(project);
    const rows = await this.db.query<
      ReviewRender & { data: Parameters<RemixReviewService['dto']>[1] }
    >(
      'SELECT r.*,t.data,p.title project_title,p.mode project_mode FROM video_remix_exports r JOIN video_remix_timelines t ON t.id=r.timeline_id JOIN video_remix_projects p ON p.id=r.project_id WHERE r.project_id=$1 ORDER BY r.version DESC LIMIT 100',
      [project],
    );
    return {
      items: rows.rows.map((r) => this.dto(r, r.data)),
      currentRenderId:
        rows.rows.find((r) => r.status === 'COMPLETED')?.id ?? null,
    };
  }
  async compare(
    project: string,
    id: string,
    otherProject: string,
    otherId: string,
  ) {
    const [a, b] = await Promise.all([
      this.detail(project, id),
      this.detail(otherProject, otherId),
    ]);
    return { a, b };
  }
  async rate(project: string, id: string, raw: unknown) {
    await this.render(project, id);
    const p = reviewSchema.safeParse(raw);
    if (!p.success)
      throw new BadRequestException(
        'Use notas de 1 a 5 ou deixe sem avaliação.',
      );
    const result = await this.db.query(
      'INSERT INTO video_remix_reviews(id,project_id,render_id,ratings,notes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(render_id) DO UPDATE SET ratings=EXCLUDED.ratings,notes=EXCLUDED.notes,revision=video_remix_reviews.revision+1,updated_at=NOW() WHERE video_remix_reviews.revision=$6 RETURNING id,ratings,notes,revision',
      [
        randomUUID(),
        project,
        id,
        p.data.ratings,
        p.data.notes,
        p.data.revision,
      ],
    );
    if (!result.rowCount)
      throw new ConflictException(
        'A avaliação foi alterada. Atualize a revisão.',
      );
    await this.event(project, 'REVIEW_SAVED', id);
    return result.rows[0];
  }
  async presets(project: string) {
    await this.assembly.story.analyses.authorize(project);
    return {
      items: EXPORT_PRESETS,
      custom: { widths: [540, 720, 1080], fps: [24, 30] },
      metadataAiEnabled: this.assembly.story.settings.enabled,
      publication: {
        automatic: false,
        youtube: 'EXISTING_INTEGRATION_ADAPTER_REQUIRED',
        instagram: 'PREPARATION_ONLY',
        tiktok: 'PREPARATION_ONLY',
      },
    };
  }
  async enqueue(project: string, id: string, raw: unknown) {
    const p = z
      .object({
        kind: z.enum(['VALIDATE', 'EXPORT', 'METADATA']),
        confirm: z.literal(true),
        platform: platformSchema.default('YOUTUBE_SHORTS'),
        custom: customExportSchema.optional(),
        deliveryId: z.uuid().optional(),
      })
      .strict()
      .safeParse(raw);
    if (!p.success)
      throw new BadRequestException('Solicitação de finalização inválida.');
    const render = await this.render(project, id);
    if (render.status !== 'COMPLETED')
      throw new BadRequestException('Aguarde a renderização concluir.');
    const timeline = await this.assembly.row(project, render.timeline_id);
    await this.assembly.historical(timeline);
    if (
      p.data.kind === 'METADATA' &&
      (!p.data.deliveryId || !this.assembly.story.settings.enabled)
    )
      throw new BadRequestException(
        'Selecione uma exportação e configure o modelo de texto antes de gerar metadados.',
      );
    let linkedDelivery: Delivery | undefined;
    if (p.data.deliveryId) {
      const d = await this.delivery(project, p.data.deliveryId);
      linkedDelivery = d;
      if (d.render_id !== id)
        throw new BadRequestException('A exportação pertence a outra versão.');
    }
    let preset: ExportPreset;
    try {
      preset =
        p.data.kind === 'METADATA'
          ? linkedDelivery!.preset
          : exportPreset(p.data.platform, p.data.custom);
    } catch {
      throw new BadRequestException('Preset personalizado inválido.');
    }
    if (p.data.kind !== 'METADATA' && p.data.deliveryId)
      throw new BadRequestException(
        'Referência de exportação permitida somente para metadados.',
      );
    const payload =
      p.data.kind === 'VALIDATE'
        ? {}
        : { preset, deliveryId: p.data.deliveryId };
    const fp = storyHash({ render: id, kind: p.data.kind, payload });
    return this.db.withClient(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('remix-export-enqueue',0))",
        );
        const prior = (
          await db.query<{
            id: string;
            status: string;
            result: Record<string, unknown>;
          }>(
            "SELECT id,status,result FROM video_remix_finalization_jobs WHERE project_id=$1 AND fingerprint=$2 AND (status IN ('QUEUED','RUNNING') OR (status='COMPLETED' AND kind='EXPORT')) ORDER BY created_at DESC LIMIT 1",
            [project, fp],
          )
        ).rows[0];
        if (prior) {
          if (prior.status !== 'COMPLETED') {
            await db.query('COMMIT');
            return prior;
          }
          const exists = await db.query<Delivery>(
            'SELECT * FROM video_remix_deliveries WHERE id=$1 AND project_id=$2',
            [prior.result.deliveryId, project],
          );
          const d = exists.rows[0],
            key = d?.storage_key ?? render.storage_key;
          if (
            d &&
            key &&
            (await this.storage.stat?.(key).catch(() => null))?.size ===
              Number(d.byte_size)
          ) {
            await db.query('COMMIT');
            return prior;
          }
        }
        const count = (
          await db.query<{ count: string }>(
            "SELECT (SELECT count(*) FROM video_remix_finalization_jobs WHERE status IN ('QUEUED','RUNNING'))+(SELECT count(*) FROM video_remix_exports WHERE status IN ('QUEUED','RUNNING')) count",
          )
        ).rows[0].count;
        if (Number(count) >= this.assembly.settings.maxQueued)
          throw new ConflictException('Fila de vídeo cheia.');
        if (p.data.kind === 'METADATA') {
          const n = (
            await db.query<{ count: string }>(
              "SELECT count(*) FROM video_remix_finalization_jobs WHERE project_id=$1 AND kind='METADATA'",
              [project],
            )
          ).rows[0].count;
          if (Number(n) >= this.assembly.story.settings.maxJobs)
            throw new ConflictException(
              'Limite de gerações de metadados deste projeto atingido.',
            );
        }
        const job = randomUUID();
        await db.query(
          "INSERT INTO video_remix_finalization_jobs(id,project_id,render_id,kind,status,fingerprint,payload) VALUES($1,$2,$3,$4,'QUEUED',$5,$6)",
          [job, project, id, p.data.kind, fp, payload],
        );
        await db.query('COMMIT');
        await this.event(project, `${p.data.kind}_REQUESTED`, job);
        return { id: job, status: 'QUEUED' };
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    });
  }
  async jobs(project: string) {
    await this.assembly.story.analyses.authorize(project);
    return {
      items: (
        await this.db.query(
          'SELECT id,render_id,kind,status,result,progress,attempts,error_message,created_at,completed_at FROM video_remix_finalization_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',
          [project],
        )
      ).rows,
    };
  }
  async cancel(project: string, id: string) {
    await this.assembly.story.analyses.authorize(project);
    await this.db.query(
      "UPDATE video_remix_finalization_jobs SET cancel_requested=true,status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END WHERE project_id=$1 AND id=$2 AND status IN ('QUEUED','RUNNING')",
      [project, id],
    );
    return { ok: true };
  }
  async delivery(project: string, id: string) {
    await this.assembly.story.analyses.authorize(project);
    const d = (
      await this.db.query<Delivery>(
        'SELECT * FROM video_remix_deliveries WHERE project_id=$1 AND id=$2',
        [project, id],
      )
    ).rows[0];
    if (!d) throw new NotFoundException('Exportação não encontrada.');
    return d;
  }
  publicDelivery(d: Delivery) {
    const { storage_key, ...safe } = d;
    void storage_key;
    return { ...safe, status: 'COMPLETED' as const };
  }
  async deliveries(project: string) {
    await this.assembly.story.analyses.authorize(project);
    return {
      items: (
        await this.db.query<Delivery>(
          'SELECT * FROM video_remix_deliveries WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',
          [project],
        )
      ).rows.map((d) => this.publicDelivery(d)),
    };
  }
  async metadata(project: string, id: string, raw: unknown) {
    const d = await this.delivery(project, id);
    const p = z
      .object({
        revision: z.number().int().nonnegative(),
        metadata: metadataSchema,
      })
      .strict()
      .safeParse(raw);
    if (!p.success)
      throw new BadRequestException(
        'Metadados inválidos. Confira título, descrição, idioma e hashtags.',
      );
    if (p.data.metadata.status === 'READY') await this.media(project, id);
    const r = await this.db.query<Delivery>(
      'UPDATE video_remix_deliveries SET metadata=$3,revision=revision+1 WHERE project_id=$1 AND id=$2 AND revision=$4 RETURNING *',
      [project, id, p.data.metadata, p.data.revision],
    );
    if (!r.rowCount)
      throw new ConflictException(
        'Os metadados foram alterados. Atualize a exportação.',
      );
    await this.event(project, 'METADATA_SAVED', d.id);
    return this.publicDelivery(r.rows[0]);
  }
  async media(project: string, id: string) {
    const d = await this.delivery(project, id),
      r = await this.render(project, d.render_id);
    await this.assembly.historical(
      await this.assembly.row(project, r.timeline_id),
    );
    const key = d.storage_key ?? r.storage_key;
    if (
      !key ||
      !this.storage.openRead ||
      (await this.storage.stat?.(key).catch(() => null))?.size !==
        Number(d.byte_size)
    )
      throw new NotFoundException('Arquivo exportado indisponível.');
    return {
      size: Number(d.byte_size),
      name: safeExportName(
        r.project_title,
        typeof r.metadata.mode === 'string' ? r.metadata.mode : r.project_mode,
        r.version,
        d.id,
      ),
      open: (a?: number, b?: number) => this.storage.openRead!(key, a, b),
    };
  }
  async removeRender(project: string, id: string) {
    await this.render(project, id);
    return this.db.withClient(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('remix-export-enqueue',0))",
        );
        const refs = await db.query(
          "SELECT id FROM video_remix_deliveries WHERE render_id=$1 UNION ALL SELECT id FROM video_remix_finalization_jobs WHERE render_id=$1 AND status IN ('QUEUED','RUNNING')",
          [id],
        );
        if (refs.rowCount)
          throw new ConflictException(
            'Esta versão está em uso por uma exportação ou processamento.',
          );
        await db.query(
          'DELETE FROM video_remix_finalization_jobs WHERE render_id=$1 AND project_id=$2',
          [id, project],
        );
        const removed = await db.query(
          "DELETE FROM video_remix_exports WHERE id=$1 AND project_id=$2 AND status NOT IN ('QUEUED','RUNNING') RETURNING id",
          [id, project],
        );
        if (!removed.rowCount)
          throw new ConflictException(
            'Cancele o processamento antes de excluir.',
          );
        await db.query('COMMIT');
        await this.event(project, 'RENDER_DELETED', id);
        return { ok: true };
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    });
  }
  async removeDelivery(project: string, id: string) {
    await this.delivery(project, id);
    if (
      (
        await this.db.query(
          "SELECT id FROM video_remix_finalization_jobs WHERE project_id=$1 AND payload->>'deliveryId'=$2 AND status IN ('QUEUED','RUNNING')",
          [project, id],
        )
      ).rowCount
    )
      throw new ConflictException('Aguarde ou cancele a geração de metadados.');
    await this.db.query(
      'DELETE FROM video_remix_deliveries WHERE project_id=$1 AND id=$2',
      [project, id],
    );
    await this.event(project, 'DELIVERY_DELETED', id);
    return { ok: true };
  }
}
