import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { RemixAnalysisService } from './remix-analysis.service';
import { RemixNarrativePlanner } from './remix-narrative-planner';
import { RemixStorySettings } from './remix-story.settings';
import { RemixVoiceService } from './remix-voice.service';
import {
  storyConfigSchema,
  segmentDraftSchema,
  storyHash,
  estimateSpeech,
  visualDuration,
  type ScriptRow,
  type StorySql,
  type SegmentRow,
  type StoryConfig,
  type StoryJob,
} from './remix-story.schema';
const revisionSchema = z.number().int().nonnegative();
@Injectable()
export class RemixStoryService {
  constructor(
    readonly analyses: RemixAnalysisService,
    readonly planner: RemixNarrativePlanner,
    readonly settings: RemixStorySettings,
    readonly voice: RemixVoiceService,
  ) {}
  get db() {
    return this.analyses.repo.db;
  }
  async options(project: string) {
    await this.analyses.authorize(project);
    return this.settings.options();
  }
  async script(project: string, id: string, db?: PoolClient, lock = false) {
    await this.analyses.authorize(project);
    const query: StorySql = db ?? this.db;
    const r = await query.query<ScriptRow>(
      `SELECT * FROM video_remix_scripts WHERE id=$1 AND project_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [id, project],
    );
    if (!r.rows[0]) throw new NotFoundException('Roteiro não encontrado.');
    return r.rows[0];
  }
  async segments(id: string, db?: PoolClient) {
    const query: StorySql = db ?? this.db;
    return (
      await query.query<SegmentRow>(
        'SELECT * FROM video_remix_script_segments WHERE script_id=$1 ORDER BY ordinal',
        [id],
      )
    ).rows;
  }
  async current(script: ScriptRow) {
    const ctx = await this.planner.context(script.project_id);
    if (ctx.hash !== script.context_hash)
      throw new ConflictException(
        'As cenas, fontes ou autorizações mudaram. Revise e valide o roteiro novamente.',
      );
    return ctx;
  }
  async evidence(project: string) {
    const context = await this.planner.context(project);
    return {
      items: context.evidence.map(({ frames, licensing, ...r }) => ({
        ...r,
        frames: frames.map((f) => ({ id: f.id, timestamp: f.timestamp })),
        authorizationDeclared: Boolean(licensing),
      })),
    };
  }
  async history(project: string) {
    await this.analyses.authorize(project);
    return {
      items: (
        await this.db.query(
          'SELECT id,version,revision,config,created_at,updated_at FROM video_remix_scripts WHERE project_id=$1 ORDER BY version DESC LIMIT 100',
          [project],
        )
      ).rows,
    };
  }
  async get(project: string, id: string) {
    const s = await this.script(project, id);
    const segments = await this.segments(id);
    let stale = false;
    try {
      await this.current(s);
    } catch {
      stale = true;
    }
    const audio = (
      await this.db.query<{
        id: string;
        duration_seconds: number;
        format: string;
        settings: unknown;
        provider: string;
        model: string;
        character_count: number;
        usage: unknown;
      }>(
        'SELECT id,duration_seconds,format,settings,provider,model,character_count,usage FROM video_remix_narrations WHERE project_id=$1 AND id=ANY($2::uuid[])',
        [
          project,
          [s.full_narration_id, ...segments.map((x) => x.narration_id)].filter(
            Boolean,
          ),
        ],
      )
    ).rows;
    const items = segments.map((segment) => {
      const refs = s.context_snapshot.evidence.filter((r) =>
        segment.candidate_ids.includes(r.id),
      );
      const narration =
        audio.find((a) => a.id === segment.narration_id) ?? null;
      const available = visualDuration(refs),
        actual = narration?.duration_seconds ?? null;
      return {
        ...segment,
        references: refs.map(({ frames, licensing, ...r }) => ({
          ...r,
          frames: frames.map((f) => ({ id: f.id, timestamp: f.timestamp })),
          authorizationDeclared: Boolean(licensing),
        })),
        narration,
        estimatedRange: estimateSpeech(
          segment.text,
          s.config,
          this.settings.wpm,
        ),
        sync: {
          visualSeconds: available,
          audioSeconds: actual,
          differenceSeconds: actual === null ? null : actual - available,
          status:
            actual === null
              ? 'PENDING'
              : actual > available + 0.15
                ? 'AUDIO_LONGER'
                : 'READY',
          suggestions:
            actual !== null && actual > available + 0.15
              ? [
                  'Reduza o texto, associe outro trecho ou ajuste a velocidade e gere novamente.',
                ]
              : [],
        },
      };
    });
    const estimated = items.reduce((n, i) => n + i.estimated_seconds, 0),
      complete = items.every((i) => i.narration),
      total = complete
        ? items.reduce((n, i) => n + i.narration!.duration_seconds, 0)
        : null,
      full = audio.find((a) => a.id === s.full_narration_id) ?? null;
    return {
      id: s.id,
      provider: s.provider,
      model: s.model,
      projectId: project,
      version: s.version,
      revision: s.revision,
      config: s.config,
      plan: s.plan,
      stale,
      segments: items,
      fullNarration: full,
      estimatedSeconds: estimated,
      actualSeconds: full?.duration_seconds ?? total,
      desiredSeconds: s.config.targetDuration,
      differenceSeconds:
        (full?.duration_seconds ?? total) === null
          ? null
          : (full?.duration_seconds ?? total)! - s.config.targetDuration,
      status: stale
        ? 'STALE'
        : items.every((i) => i.validation.status === 'SUPPORTED')
          ? 'VALIDATED'
          : 'NEEDS_REVIEW',
      fullText: segments.map((x) => x.text).join('\n\n'),
    };
  }
  async snapshot(script: ScriptRow, db: PoolClient) {
    await db.query(
      'INSERT INTO video_remix_script_revisions(id,script_id,revision,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [
        randomUUID(),
        script.id,
        script.revision,
        { script, segments: await this.segments(script.id, db) },
      ],
    );
  }
  async update(project: string, id: string, raw: unknown) {
    const parsed = z
      .object({
        revision: revisionSchema,
        config: storyConfigSchema.optional(),
        segments: z
          .array(segmentDraftSchema.extend({ id: z.uuid().optional() }))
          .min(1)
          .max(12)
          .optional(),
      })
      .strict()
      .safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(
        'Alteração de roteiro inválida. Use até 12 segmentos, textos de até 1000 caracteres e referências válidas.',
      );
    const context = await this.planner.context(project);
    return this.db
      .withClient(async (db) => {
        await db.query('BEGIN');
        try {
          const s = await this.script(project, id, db, true);
          if (s.revision !== parsed.data.revision)
            throw new ConflictException(
              'Roteiro alterado em outra janela. Atualize a página.',
            );
          await this.snapshot(s, db);
          const config = parsed.data.config ?? s.config,
            old = await this.segments(id, db);
          const drafts =
            parsed.data.segments ??
            old.map((x) => ({
              id: x.id,
              kind: x.kind,
              text: x.text,
              candidateIds: x.candidate_ids,
              notes: x.notes,
            }));
          const ids = drafts.map((d) => d.id).filter(Boolean);
          if (
            new Set(ids).size !== ids.length ||
            ids.some((id) => !old.some((o) => o.id === id))
          )
            throw new BadRequestException('IDs de segmentos inválidos.');
          const voiceChanged =
            storyHash(this.voice.configuration(config)) !==
            storyHash(this.voice.configuration(s.config));
          await db.query(
            'DELETE FROM video_remix_script_segments WHERE script_id=$1',
            [id],
          );
          for (const [ordinal, d] of drafts.entries()) {
            if (
              d.candidateIds.some(
                (id) => !context.evidence.some((r) => r.id === id),
              )
            )
              throw new BadRequestException(
                'Selecione cenas válidas antes de associar ao roteiro.',
              );
            const prior = old.find((o) => o.id === d.id),
              changed =
                !prior ||
                prior.text !== d.text ||
                prior.kind !== d.kind ||
                storyHash(prior.candidate_ids) !== storyHash(d.candidateIds) ||
                context.hash !== s.context_hash;
            await db.query(
              'INSERT INTO video_remix_script_segments(id,script_id,ordinal,kind,text,candidate_ids,estimated_seconds,notes,validation,narration_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
              [
                d.id ?? randomUUID(),
                id,
                ordinal,
                d.kind,
                d.text,
                d.candidateIds,
                estimateSpeech(d.text, config, this.settings.wpm).seconds,
                d.notes,
                changed ? { status: 'PENDING' } : prior.validation,
                changed || voiceChanged ? null : prior.narration_id,
              ],
            );
          }
          await db.query(
            'UPDATE video_remix_scripts SET config=$2,revision=revision+1,context_hash=$3,context_snapshot=$4,full_narration_id=NULL,updated_at=NOW() WHERE id=$1',
            [id, config, context.hash, context],
          );
          await db.query('COMMIT');
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        }
      })
      .then(() => this.get(project, id));
  }
  async enqueue(project: string, kind: StoryJob['kind'], raw: unknown) {
    if (!this.settings.enabled)
      throw new ServiceUnavailableException(
        'Configure OPENAI_API_KEY e VIDEO_REMIX_SCRIPT_MODEL (multimodal), ou VIDEO_REMIX_ANALYSIS_MODEL.',
      );
    const schema = z
      .object({
        confirm: z.literal(true),
        config: storyConfigSchema.optional(),
        scriptId: z.uuid().optional(),
        revision: revisionSchema.optional(),
        segmentId: z.uuid().optional(),
        mode: z.enum(['SEGMENTED', 'FULL']).optional(),
      })
      .strict();
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(
        'Confirme a operação e informe parâmetros válidos.',
      );
    const r = parsed.data,
      context = await this.planner.context(project);
    let config: StoryConfig;
    let reserved = 0;
    if (kind === 'SCRIPT') {
      if (!r.config)
        throw new BadRequestException('Informe a configuração do roteiro.');
      config = r.config;
    } else {
      if (!r.scriptId || r.revision === undefined)
        throw new BadRequestException('Informe o roteiro e sua revisão.');
      const s = await this.script(project, r.scriptId);
      if (s.revision !== r.revision)
        throw new ConflictException('Roteiro alterado. Atualize a página.');
      config = s.config;
      if (kind === 'NARRATE' && s.context_hash !== context.hash)
        throw new ConflictException(
          'Valide novamente o roteiro após alterações nas cenas.',
        );
      const segments = await this.segments(s.id);
      if (r.segmentId && !segments.some((x) => x.id === r.segmentId))
        throw new NotFoundException('Segmento não encontrado.');
      if (kind === 'REGENERATE' && !r.segmentId)
        throw new BadRequestException('Informe o segmento a regenerar.');
      if (kind === 'NARRATE') {
        if (r.mode === 'FULL' && r.segmentId)
          throw new BadRequestException(
            'Narração completa deve incluir todo o roteiro.',
          );
        const targets = r.segmentId
          ? segments.filter((x) => x.id === r.segmentId)
          : segments;
        if (targets.some((x) => x.validation.status !== 'SUPPORTED'))
          throw new BadRequestException(
            'Revise os avisos e valide a correspondência visual. Apenas segmentos SUPPORTED podem ser narrados.',
          );
        const texts =
          r.mode === 'FULL'
            ? [targets.map((x) => x.text).join('\n\n')]
            : targets.map((x) => x.text);
        for (const text of texts) {
          this.settings.tts.validateText(text);
          const fingerprint = this.voice.fingerprint(text, config);
          if (
            !(
              await this.db.query(
                'SELECT 1 FROM video_remix_narrations WHERE project_id=$1 AND fingerprint=$2',
                [project, fingerprint],
              )
            ).rowCount
          )
            reserved += text.length;
        }
      }
    }
    const payload = {
        configurationHash: storyHash({
          model: this.settings.model,
          voice: this.voice.configuration(config),
        }),
        scriptModel: this.settings.model,
        ttsModel: this.settings.tts.model,
        ttsProvider: this.settings.tts.provider,
        contextHash: context.hash,
        config,
        scriptId: r.scriptId,
        revision: r.revision,
        segmentId: r.segmentId,
        mode: r.mode ?? 'SEGMENTED',
      },
      fingerprint = storyHash({ kind, payload });
    return this.db.withClient(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('remix-story-enqueue',0))",
        );
        const prior = await db.query<{ id: string; status: string }>(
          "SELECT id,status FROM video_remix_story_jobs WHERE project_id=$1 AND fingerprint=$2 AND status IN ('QUEUED','RUNNING','COMPLETED') ORDER BY created_at DESC LIMIT 1",
          [project, fingerprint],
        );
        if (prior.rows[0]) {
          await db.query('COMMIT');
          return prior.rows[0];
        }
        const limits = await db.query<{
          count: string;
          characters: string;
          active: string;
        }>(
          "SELECT count(*) count,COALESCE(sum(reserved_characters),0) characters,(SELECT count(*) FROM video_remix_story_jobs WHERE status IN ('QUEUED','RUNNING')) active FROM video_remix_story_jobs WHERE project_id=$1",
          [project],
        );
        const l = limits.rows[0];
        if (
          Number(l.count) >= this.settings.maxJobs ||
          Number(l.characters) + reserved > this.settings.maxCharacters ||
          Number(l.active) >= 20
        )
          throw new ConflictException(
            'Limite de gerações, caracteres do projeto ou fila atingido.',
          );
        const id = randomUUID();
        await db.query(
          "INSERT INTO video_remix_story_jobs(id,project_id,kind,status,fingerprint,payload,reserved_characters) VALUES($1,$2,$3,'QUEUED',$4,$5,$6)",
          [id, project, kind, fingerprint, payload, reserved],
        );
        await db.query('COMMIT');
        return { id, status: 'QUEUED' };
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    });
  }
  async jobs(project: string) {
    await this.analyses.authorize(project);
    return {
      items: (
        await this.db.query(
          `SELECT id,kind,status,result_id,progress,usage,reserved_characters,payload->>'scriptModel' script_model,payload->>'ttsModel' tts_model,payload->>'ttsProvider' tts_provider,error_message,created_at,completed_at FROM video_remix_story_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`,
          [project],
        )
      ).rows,
    };
  }
  async cancel(project: string, id: string) {
    await this.analyses.authorize(project);
    await this.db.query(
      "UPDATE video_remix_story_jobs SET cancel_requested=true,status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END WHERE id=$1 AND project_id=$2 AND status IN ('QUEUED','RUNNING')",
      [id, project],
    );
    return { ok: true };
  }
  async audio(project: string, scriptId: string, id: string) {
    const script = await this.script(project, scriptId);
    await this.current(script);
    const segments = await this.segments(scriptId);
    if (
      script.full_narration_id !== id &&
      !segments.some(
        (s) => s.narration_id === id && s.validation.status === 'SUPPORTED',
      )
    )
      throw new NotFoundException(
        'Áudio não corresponde à versão atual do roteiro.',
      );
    const r = await this.db.query<{
      storage_key: string;
      format: string;
      byte_size: number;
    }>(
      'SELECT storage_key,format,byte_size FROM video_remix_narrations WHERE project_id=$1 AND id=$2',
      [project, id],
    );
    if (!r.rows[0]) throw new NotFoundException('Áudio não encontrado.');
    const f = r.rows[0],
      storage = this.analyses.files.storage;
    if (
      !storage.openRead ||
      (await storage.stat?.(f.storage_key))?.size !== f.byte_size
    )
      throw new NotFoundException('Áudio indisponível.');
    return {
      size: f.byte_size,
      mime: f.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      open: (start?: number, end?: number) =>
        storage.openRead!(f.storage_key, start, end),
    };
  }
}
