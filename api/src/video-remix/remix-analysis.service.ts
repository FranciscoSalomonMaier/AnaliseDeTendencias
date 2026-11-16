import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { VideoRemixService } from './video-remix.service';
import { VideoRemixRepository } from './video-remix.repository';
import { RemixFilesService } from './remix-files.service';
import { RemixAnalysisSettings } from './remix-analysis.settings';
import {
  analysisRequest,
  relevanceBand,
  sceneResult,
  type AnalysisJob,
} from './remix-analysis.schema';
const profileSchema = z.enum(['ECONOMIC', 'DETAILED']);
@Injectable()
export class RemixAnalysisService {
  constructor(
    readonly projects: VideoRemixService,
    readonly repo: VideoRemixRepository,
    readonly files: RemixFilesService,
    readonly settings: RemixAnalysisSettings,
  ) {}
  async authorize(project: string) {
    return this.repo.get(project, this.projects.owner());
  }
  async source(project: string, source: string) {
    const p = await this.authorize(project);
    const s = (await this.repo.sources(project)).find((s) => s.id === source);
    if (!s) throw new NotFoundException('Fonte não encontrada.');
    if (
      s.status !== 'IMPORTED' ||
      !s.importedFileId ||
      !(s.licensing as { userDeclaredRights?: boolean }).userDeclaredRights
    )
      throw new BadRequestException(
        'Importe e autorize o arquivo antes da análise.',
      );
    const f = await this.files.get(project, s.importedFileId);
    await this.files.media(project, f.id);
    return { p, s, f };
  }
  async estimate(project: string, raw: unknown) {
    const r = z
      .object({
        profile: profileSchema.default('ECONOMIC'),
        sourceId: z.uuid().optional(),
      })
      .strict()
      .safeParse(raw);
    if (!r.success)
      throw new BadRequestException('Configuração de análise inválida.');
    const p = await this.authorize(project);
    const c = this.settings.profile(r.data.profile);
    const sources = (await this.repo.sources(project)).filter(
      (s) =>
        s.status === 'IMPORTED' &&
        s.importedFileId &&
        (!r.data.sourceId || s.id === r.data.sourceId),
    );
    const items: Array<
      { sourceId: string; title: string } & ReturnType<
        RemixAnalysisSettings['estimate']
      >
    > = [];
    for (const s of sources) {
      const { f } = await this.source(project, s.id);
      items.push({
        sourceId: s.id,
        title: s.title,
        ...this.settings.estimate(f.duration_seconds, c),
      });
    }
    if (!items.length)
      throw new BadRequestException(
        'Nenhuma fonte importada e autorizada disponível.',
      );
    return {
      enabled: this.settings.enabled,
      model: c.model,
      config: c,
      items,
      topic: p.topic,
      estimatedUpperUsd: items.every((i) => i.estimatedUpperUsd !== null)
        ? items.reduce((n, i) => n + i.estimatedUpperUsd!, 0)
        : null,
    };
  }
  async start(project: string, raw: unknown) {
    const parsed = analysisRequest.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(
        'Confirme a análise e escolha um perfil válido.',
      );
    if (!this.settings.enabled)
      throw new ServiceUnavailableException(
        'Configure OPENAI_API_KEY e VIDEO_REMIX_ANALYSIS_MODEL com um modelo multimodal compatível.',
      );
    const p = await this.authorize(project);
    if (p.status !== 'DRAFT')
      throw new ConflictException(
        'Análise disponível apenas em projetos DRAFT.',
      );
    const c = this.settings.profile(parsed.data.profile);
    const sources = (await this.repo.sources(project)).filter(
      (s) =>
        s.status === 'IMPORTED' &&
        s.importedFileId &&
        (!parsed.data.sourceId || s.id === parsed.data.sourceId),
    );
    if (!sources.length)
      throw new BadRequestException(
        'Nenhuma fonte importada e autorizada disponível.',
      );
    const jobs: Array<{ id: string; status: string }> = [];
    for (const s of sources) {
      const { f } = await this.source(project, s.id);
      const estimate = this.settings.estimate(f.duration_seconds, c);
      if (
        c.maxUsd !== null &&
        (estimate.estimatedUpperUsd === null ||
          estimate.estimatedUpperUsd > c.maxUsd)
      )
        throw new BadRequestException(
          'O limite de custo exige preços e limite de tokens de imagem configurados, e estimativa dentro do orçamento.',
        );
    }
    await this.repo.db.withClient(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('remix-analysis-enqueue',0))",
        );
        const queued = await db.query<{ count: string }>(
          "SELECT count(*) FROM video_remix_analyses WHERE status IN ('QUEUED','RUNNING')",
        );
        if (Number(queued.rows[0].count) + sources.length > 20)
          throw new ConflictException(
            'Fila de análises cheia. Aguarde os trabalhos atuais.',
          );
        for (const s of sources) {
          const context = {
            topic: p.topic,
            language: p.narrationLanguage,
            licensing: s.licensing,
          };
          const fingerprint = createHash('sha256')
            .update(JSON.stringify({ file: s.importedFileId, context, c }))
            .digest('hex');
          const prior = await db.query<{ id: string; status: string }>(
            "SELECT id,status FROM video_remix_analyses WHERE source_id=$1 AND fingerprint=$2 AND status IN ('QUEUED','RUNNING','COMPLETED') ORDER BY created_at DESC LIMIT 1",
            [s.id, fingerprint],
          );
          if (prior.rows[0]) {
            jobs.push(prior.rows[0]);
            continue;
          }
          const id = randomUUID();
          await db.query(
            "INSERT INTO video_remix_analyses(id,project_id,source_id,file_id,fingerprint,status,config,context) VALUES($1,$2,$3,$4,$5,'QUEUED',$6,$7)",
            [id, project, s.id, s.importedFileId, fingerprint, c, context],
          );
          jobs.push({ id, status: 'QUEUED' });
        }
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    });
    return { items: jobs };
  }
  async job(project: string, id: string) {
    await this.authorize(project);
    const r = await this.repo.db.query<AnalysisJob>(
      'SELECT * FROM video_remix_analyses WHERE project_id=$1 AND id=$2',
      [project, id],
    );
    if (!r.rows[0]) throw new NotFoundException('Análise não encontrada.');
    return r.rows[0];
  }
  async list(project: string) {
    await this.authorize(project);
    const r = await this.repo.db.query(
      'SELECT id,source_id,file_id,status,config,context,progress,metadata,usage,attempts,error_message,started_at,completed_at,created_at FROM video_remix_analyses WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',
      [project],
    );
    return { items: r.rows };
  }
  async results(project: string, id: string) {
    const job = await this.job(project, id);
    const current = await this.source(project, job.source_id);
    if (current.f.id !== job.file_id)
      throw new ConflictException(
        'A fonte está associada a outro arquivo. Consulte a análise atual.',
      );
    const scenes = await this.repo.db.query(
      "SELECT s.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'timestamp',f.timestamp_seconds,'width',f.width,'height',f.height) ORDER BY f.timestamp_seconds) FROM video_remix_scene_frames f WHERE f.scene_id=s.id),'[]') frames FROM video_remix_scenes s WHERE analysis_id=$1 ORDER BY ordinal",
      [id],
    );
    const candidates = await this.repo.db.query(
      'SELECT * FROM video_remix_segment_candidates WHERE analysis_id=$1 ORDER BY relevance DESC,start_seconds',
      [id],
    );
    return {
      analysis: job,
      scenes: scenes.rows,
      candidates: candidates.rows.map((candidate) => ({
        ...candidate,
        relevanceBand: relevanceBand(
          Number(candidate.relevance),
          job.config.relevanceBands,
        ),
        narrativeRole:
          (
            scenes.rows.find((scene) =>
              (candidate.scene_ids as string[]).includes(scene.id as string),
            )?.result as { narrativeRole?: string } | undefined
          )?.narrativeRole ?? 'OTHER',
      })),
    };
  }
  async cancel(project: string, id: string) {
    await this.job(project, id);
    await this.repo.db.query(
      "UPDATE video_remix_analyses SET cancel_requested=true,status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END WHERE id=$1 AND status IN ('QUEUED','RUNNING')",
      [id],
    );
    return { ok: true };
  }
  async recover(project: string, id: string) {
    const job = await this.job(project, id);
    const { p, s, f } = await this.source(project, job.source_id);
    if (
      f.id !== job.file_id ||
      p.topic !== job.context.topic ||
      JSON.stringify(s.licensing) !== JSON.stringify(job.context.licensing)
    )
      throw new ConflictException('Fonte, tema ou autorização alterados.');
    await this.repo.db.withClient(async (db) => {
      await db.query('BEGIN');
      try {
        const locked = await db.query<
          AnalysisJob & { progress: { stage: string; total: number } }
        >('SELECT * FROM video_remix_analyses WHERE id=$1 FOR UPDATE', [id]);
        const current = locked.rows[0];
        if (
          current?.status !== 'FAILED' ||
          current.cancel_requested ||
          current.progress?.stage !== 'RELEVANCE'
        )
          throw new ConflictException(
            'A recuperação exige falha na finalização, com todas as cenas analisadas.',
          );
        const scenes = await db.query<{
          id: string;
          start_seconds: number;
          end_seconds: number;
          result: unknown;
        }>(
          'SELECT * FROM video_remix_scenes WHERE analysis_id=$1 ORDER BY ordinal',
          [id],
        );
        if (
          !scenes.rows.length ||
          scenes.rows.length !== current.progress.total
        )
          throw new ConflictException(
            'A análise não possui todas as cenas necessárias.',
          );
        for (const scene of scenes.rows) {
          const r = sceneResult.parse(scene.result);
          const evidence = r.events.some((e) => e.evidence === 'INFERRED')
            ? 'INFERRED'
            : r.events.some((e) => e.evidence === 'UNCONFIRMED')
              ? 'UNCONFIRMED'
              : 'OBSERVED';
          await db.query(
            'INSERT INTO video_remix_segment_candidates(id,analysis_id,scene_ids,start_seconds,end_seconds,description,justification,relevance,confidence,evidence_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [
              randomUUID(),
              id,
              [scene.id],
              scene.start_seconds,
              scene.end_seconds,
              r.description,
              r.justification,
              r.relevance,
              r.confidence,
              evidence,
            ],
          );
        }
        await db.query(
          "UPDATE video_remix_analyses SET status='COMPLETED',error_message=NULL,completed_at=NOW(),progress=$2 WHERE id=$1",
          [
            id,
            {
              stage: 'COMPLETED',
              completed: scenes.rows.length,
              total: scenes.rows.length,
              recovered: true,
            },
          ],
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    });
    return this.results(project, id);
  }
  async retry(project: string, id: string) {
    const j = await this.job(project, id);
    if (j.status !== 'FAILED' && j.status !== 'CANCELLED')
      throw new ConflictException(
        'Reprocessamento disponível apenas após falha ou cancelamento.',
      );
    return this.start(project, {
      profile: j.config.profile,
      sourceId: j.source_id,
      confirm: true,
    });
  }
  async select(project: string, id: string, candidate: string, raw: unknown) {
    const j = await this.job(project, id);
    if (j.status !== 'COMPLETED')
      throw new ConflictException('Aguarde a conclusão da análise.');
    const { f, p, s } = await this.source(project, j.source_id);
    if (
      f.id !== j.file_id ||
      p.topic !== j.context.topic ||
      JSON.stringify(s.licensing) !== JSON.stringify(j.context.licensing)
    )
      throw new ConflictException(
        'Análise desatualizada. Analise a fonte atual antes de selecionar.',
      );
    const parsed = z
      .object({
        selected: z.boolean(),
        start: z.number().nonnegative(),
        end: z.number().positive(),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.end <= parsed.data.start ||
      parsed.data.end > Math.min(f.duration_seconds, j.config.maxDuration)
    )
      throw new BadRequestException('Intervalo ou seleção inválida.');
    const d = parsed.data;
    const r = await this.repo.db.query(
      'UPDATE video_remix_segment_candidates SET selected=$1,start_seconds=$2,end_seconds=$3,revision=revision+1 WHERE id=$4 AND analysis_id=$5 AND revision=$6 RETURNING *',
      [d.selected, d.start, d.end, candidate, id, d.revision],
    );
    if (!r.rows[0])
      throw new ConflictException(
        'Trecho alterado ou indisponível. Atualize a lista.',
      );
    return r.rows[0];
  }
  async frame(project: string, analysis: string, frame: string) {
    const j = await this.job(project, analysis);
    const current = await this.source(project, j.source_id);
    if (current.f.id !== j.file_id)
      throw new ConflictException('Arquivo da análise desatualizado.');
    const r = await this.repo.db.query<{ storage_key: string }>(
      `SELECT f.storage_key FROM video_remix_scene_frames f JOIN video_remix_scenes s ON s.id=f.scene_id WHERE s.analysis_id=$1 AND f.id=$2`,
      [analysis, frame],
    );
    if (!r.rows[0]) throw new NotFoundException('Frame não encontrado.');
    return this.files.storage.read(r.rows[0].storage_key);
  }
}
