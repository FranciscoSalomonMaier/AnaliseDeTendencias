import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { RemixStoryService } from './remix-story.service';
import { RemixScriptAiService } from './remix-script-ai.service';
import {
  storyHash,
  estimateSpeech,
  type StoryJob,
  type StoryDraft,
  type StoryContext,
  type SegmentRow,
  type Support,
} from './remix-story.schema';
@Injectable()
export class RemixStoryWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RemixStoryWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  private active?: AbortController;
  constructor(
    private readonly service: RemixStoryService,
    private readonly ai: RemixScriptAiService,
  ) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), 1500);
    this.timer.unref();
    void this.tick();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.active?.abort();
    await this.running;
  }
  async tick() {
    if (this.running || this.stopping) return;
    this.running = this.work()
      .catch(() =>
        this.logger.warn(
          'Fila de roteiro/narração indisponível. Confira a migration 018 e o banco.',
        ),
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async work() {
    await this.service.db.withClient(async (db) => {
      const lock = await db.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('remix-story-worker',0)) ok",
      );
      if (!lock.rows[0].ok) return;
      try {
        await db.query(
          "UPDATE video_remix_story_jobs SET status='FAILED',error_message='Processamento interrompido. Revise o consumo antes de repetir.',completed_at=NOW() WHERE status='RUNNING'",
        );
        const r = await db.query<StoryJob>(
          "UPDATE video_remix_story_jobs SET status='RUNNING' WHERE id=(SELECT id FROM video_remix_story_jobs WHERE status='QUEUED' ORDER BY created_at LIMIT 1) RETURNING *",
        );
        if (r.rows[0]) await this.execute(r.rows[0], db);
      } finally {
        await db.query(
          "SELECT pg_advisory_unlock(hashtextextended('remix-story-worker',0))",
        );
      }
    });
  }
  private async execute(job: StoryJob, db: PoolClient) {
    const s = this.service,
      abort = new AbortController();
    this.active = abort;
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      charactersSubmitted: 0,
    };
    const pendingKeys: string[] = [];
    const deadline = setTimeout(() => abort.abort(), 30 * 60 * 1000);
    deadline.unref();
    const pulse = setInterval(
      () =>
        void db
          .query<{ cancel_requested: boolean }>(
            'SELECT cancel_requested FROM video_remix_story_jobs WHERE id=$1',
            [job.id],
          )
          .then((r) => {
            if (!r.rows[0] || r.rows[0].cancel_requested) abort.abort();
          })
          .catch(() => abort.abort()),
      1000,
    );
    pulse.unref();
    const check = () => {
      if (abort.signal.aborted)
        throw new Error('Operação cancelada ou tempo limite atingido.');
    };
    const ensure = async () => {
      check();
      if (
        job.payload.configurationHash !==
        storyHash({
          model: s.settings.model,
          voice: s.voice.configuration(job.payload.config),
        })
      )
        throw new Error('Configuração alterada.');
      const ctx = await s.planner.context(job.project_id);
      if (ctx.hash !== job.payload.contextHash)
        throw new Error('As cenas selecionadas ou autorizações mudaram.');
      return ctx;
    };
    const consume = async (value: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }) => {
      usage.inputTokens += value.inputTokens;
      usage.outputTokens += value.outputTokens;
      usage.totalTokens += value.totalTokens;
      await db.query('UPDATE video_remix_story_jobs SET usage=$2 WHERE id=$1', [
        job.id,
        usage,
      ]);
    };
    const progress = async (
      stage: string,
      completed: number,
      total: number,
    ) => {
      check();
      await db.query(
        'UPDATE video_remix_story_jobs SET progress=$2 WHERE id=$1',
        [job.id, { stage, completed, total }],
      );
      this.logger.log(
        `Roteiro Remix ${job.id}: ${stage} ${completed}/${total}`,
      );
    };
    const validate = async (draft: StoryDraft, ctx: StoryContext) => {
      await ensure();
      if (
        draft.candidateIds.some((id) => !ctx.evidence.some((r) => r.id === id))
      )
        return {
          status: 'UNSUPPORTED' as const,
          reason: 'Uma referência deixou de estar selecionada ou disponível.',
          suggestedRewrite: 'Selecione outra cena e revise o texto.',
        };
      const result = await this.ai.validate(
        draft,
        ctx.evidence.filter((r) => draft.candidateIds.includes(r.id)),
        abort.signal,
      );
      await consume(result.usage);
      return result.data;
    };
    const guardedScript = async () => {
      if (!job.payload.scriptId) throw new Error('Roteiro ausente');
      const script = await s.script(
        job.project_id,
        job.payload.scriptId,
        db,
        true,
      );
      if (script.revision !== job.payload.revision)
        throw new Error('Roteiro alterado durante o processamento.');
      return script;
    };
    try {
      const context = await ensure();
      let resultId: string | undefined = job.payload.scriptId;
      if (job.kind === 'SCRIPT' || job.kind === 'REGENERATE') {
        await progress('PLANNING', 0, 1);
        let original: SegmentRow | undefined;
        if (job.kind === 'REGENERATE') {
          const script = await s.script(job.project_id, job.payload.scriptId!);
          if (script.revision !== job.payload.revision)
            throw new Error('Roteiro alterado');
          original = (await s.segments(script.id)).find(
            (x) => x.id === job.payload.segmentId,
          );
          if (!original) throw new Error('Segmento ausente');
        }
        const response = await this.ai.generate(
          context,
          job.payload.config,
          abort.signal,
          original
            ? {
                kind: original.kind,
                text: original.text,
                candidateIds: original.candidate_ids,
                notes: original.notes,
              }
            : undefined,
        );
        await consume(response.usage);
        const drafts = response.data.segments;
        if (
          drafts.some(
            (d) =>
              new Set(d.candidateIds).size !== d.candidateIds.length ||
              d.candidateIds.some(
                (id) => !context.evidence.some((r) => r.id === id),
              ),
          )
        )
          throw new Error('A IA referenciou cenas que não foram selecionadas.');
        const validated: Array<{ draft: StoryDraft; validation: Support }> = [];
        for (const [index, draft] of drafts.entries()) {
          await progress('VALIDATING', index, drafts.length);
          validated.push({ draft, validation: await validate(draft, context) });
        }
        await ensure();
        await db.query('BEGIN');
        try {
          if (original) {
            const script = await guardedScript();
            await s.snapshot(script, db);
            if (script.context_hash !== context.hash)
              await db.query(
                'UPDATE video_remix_script_segments SET validation=\'{"status":"PENDING"}\',narration_id=NULL WHERE script_id=$1',
                [script.id],
              );
            const { draft, validation } = validated[0];
            await db.query(
              'UPDATE video_remix_script_segments SET kind=$2,text=$3,candidate_ids=$4,notes=$5,validation=$6,narration_id=NULL,estimated_seconds=$7 WHERE id=$1 AND script_id=$8',
              [
                original.id,
                draft.kind,
                draft.text,
                draft.candidateIds,
                draft.notes,
                validation,
                estimateSpeech(draft.text, script.config, s.settings.wpm)
                  .seconds,
                script.id,
              ],
            );
            await db.query(
              'UPDATE video_remix_scripts SET revision=revision+1,full_narration_id=NULL,context_hash=$2,context_snapshot=$3,updated_at=NOW() WHERE id=$1',
              [script.id, context.hash, context],
            );
            resultId = script.id;
          } else {
            await db.query(
              'SELECT id FROM video_remix_projects WHERE id=$1 FOR UPDATE',
              [job.project_id],
            );
            const v = await db.query<{ version: number }>(
              'SELECT COALESCE(MAX(version),0)+1 version FROM video_remix_scripts WHERE project_id=$1',
              [job.project_id],
            );
            resultId = randomUUID();
            await db.query(
              'INSERT INTO video_remix_scripts(id,project_id,version,config,plan,context_hash,context_snapshot,provider,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
              [
                resultId,
                job.project_id,
                v.rows[0].version,
                job.payload.config,
                response.data.plan,
                context.hash,
                context,
                response.provider,
                response.model,
              ],
            );
            for (const [index, { draft, validation }] of validated.entries())
              await db.query(
                'INSERT INTO video_remix_script_segments(id,script_id,ordinal,kind,text,candidate_ids,estimated_seconds,notes,validation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
                [
                  randomUUID(),
                  resultId,
                  index,
                  draft.kind,
                  draft.text,
                  draft.candidateIds,
                  estimateSpeech(draft.text, job.payload.config, s.settings.wpm)
                    .seconds,
                  draft.notes,
                  validation,
                ],
              );
          }
          check();
          await db.query('COMMIT');
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        }
      } else if (job.kind === 'VALIDATE') {
        const script = await s.script(job.project_id, job.payload.scriptId!);
        if (script.revision !== job.payload.revision)
          throw new Error('Roteiro alterado');
        const segments = await s.segments(script.id),
          validated: Array<{ segment: SegmentRow; validation: Support }> = [];
        for (const [index, segment] of segments.entries()) {
          await progress('VALIDATING', index, segments.length);
          validated.push({
            segment,
            validation: await validate(
              {
                kind: segment.kind,
                text: segment.text,
                candidateIds: segment.candidate_ids,
                notes: segment.notes,
              },
              context,
            ),
          });
        }
        await ensure();
        await db.query('BEGIN');
        try {
          const current = await guardedScript();
          await s.snapshot(current, db);
          for (const { segment, validation } of validated)
            await db.query(
              'UPDATE video_remix_script_segments SET validation=$2,narration_id=CASE WHEN $3 THEN narration_id ELSE NULL END WHERE id=$1',
              [
                segment.id,
                validation,
                validation.status === 'SUPPORTED' &&
                  current.context_hash === context.hash,
              ],
            );
          await db.query(
            'UPDATE video_remix_scripts SET revision=revision+1,context_hash=$2,context_snapshot=$3,full_narration_id=NULL,updated_at=NOW() WHERE id=$1',
            [script.id, context.hash, context],
          );
          check();
          await db.query('COMMIT');
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        }
      } else {
        const script = await s.script(job.project_id, job.payload.scriptId!);
        if (
          script.revision !== job.payload.revision ||
          script.context_hash !== context.hash
        )
          throw new Error('Roteiro alterado');
        const segments = (await s.segments(script.id)).filter(
          (x) => !job.payload.segmentId || x.id === job.payload.segmentId,
        );
        if (
          !segments.length ||
          segments.some((x) => x.validation.status !== 'SUPPORTED')
        )
          throw new Error('Validação visual pendente');
        const targets =
          job.payload.mode === 'FULL'
            ? [{ id: null, text: segments.map((x) => x.text).join('\n\n') }]
            : segments.map((x) => ({ id: x.id, text: x.text }));
        for (const [index, target] of targets.entries()) {
          await progress('NARRATING', index, targets.length);
          await ensure();
          const fingerprint = s.voice.fingerprint(target.text, script.config);
          let audio = (
            await db.query<{
              id: string;
              storage_key: string;
              byte_size: number;
            }>(
              'SELECT id,storage_key,byte_size FROM video_remix_narrations WHERE project_id=$1 AND fingerprint=$2',
              [job.project_id, fingerprint],
            )
          ).rows[0];
          if (audio) {
            const size = await s.analyses.files.storage
              .stat?.(audio.storage_key)
              .catch(() => null);
            if (size?.size !== audio.byte_size) {
              await db.query('DELETE FROM video_remix_narrations WHERE id=$1', [
                audio.id,
              ]);
              audio = undefined!;
            }
          }
          if (!audio) {
            usage.charactersSubmitted += target.text.length;
            await db.query(
              'UPDATE video_remix_story_jobs SET usage=$2 WHERE id=$1',
              [job.id, usage],
            );
            const generated = await s.voice.generate(
              target.text,
              script.config,
              abort.signal,
            );
            check();
            const id = randomUUID(),
              key = `remix-narration/${job.project_id}/${id}.${generated.extension}`;
            pendingKeys.push(key);
            await db.query(
              "INSERT INTO video_remix_storage_cleanup(storage_key,not_before) VALUES($1,NOW()+interval '1 hour') ON CONFLICT DO NOTHING",
              [key],
            );
            await s.analyses.files.storage.save(key, generated.audio);
            await db.query(
              'INSERT INTO video_remix_narrations(id,project_id,fingerprint,storage_key,duration_seconds,format,byte_size,settings,provider,model,character_count,usage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
              [
                id,
                job.project_id,
                fingerprint,
                key,
                generated.durationSeconds,
                generated.extension,
                generated.audio.length,
                s.voice.configuration(script.config),
                generated.provider,
                generated.model,
                target.text.length,
                generated.usage,
              ],
            );
            await db.query(
              'DELETE FROM video_remix_storage_cleanup WHERE storage_key=$1',
              [key],
            );
            audio = { id, storage_key: key, byte_size: generated.audio.length };
          }
          await ensure();
          await db.query('BEGIN');
          try {
            await guardedScript();
            if (target.id)
              await db.query(
                'UPDATE video_remix_script_segments SET narration_id=$2 WHERE id=$1 AND script_id=$3',
                [target.id, audio.id, script.id],
              );
            else
              await db.query(
                'UPDATE video_remix_scripts SET full_narration_id=$2 WHERE id=$1',
                [script.id, audio.id],
              );
            check();
            await db.query('COMMIT');
          } catch (e) {
            await db.query('ROLLBACK');
            throw e;
          }
          await progress('NARRATING', index + 1, targets.length);
        }
        await db.query(
          'UPDATE video_remix_scripts SET revision=revision+1,updated_at=NOW() WHERE id=$1 AND revision=$2',
          [script.id, job.payload.revision],
        );
      }
      await ensure();
      check();
      const finished = await db.query(
        "UPDATE video_remix_story_jobs SET status='COMPLETED',result_id=$2,progress=$3,completed_at=NOW() WHERE id=$1 AND cancel_requested=false RETURNING id",
        [job.id, resultId, { stage: 'COMPLETED' }],
      );
      if (!finished.rowCount) throw new Error('Operação cancelada');
    } catch (error) {
      const state = await db.query<{ cancel_requested: boolean }>(
        'SELECT cancel_requested FROM video_remix_story_jobs WHERE id=$1',
        [job.id],
      );
      const cancelled = state.rows[0]?.cancel_requested;
      await db.query(
        'UPDATE video_remix_story_jobs SET status=$2,error_message=$3,usage=$4,completed_at=NOW() WHERE id=$1',
        [
          job.id,
          cancelled ? 'CANCELLED' : 'FAILED',
          cancelled
            ? 'Operação cancelada.'
            : 'Não foi possível concluir. Verifique cenas/roteiro atuais, chave, modelo, saldo e arquivos. Resultados parciais e consumo reportado foram preservados; repetir pode gerar custos.',
          usage,
        ],
      );
      this.logger.warn(
        `Roteiro Remix ${job.id}: ${cancelled ? 'cancelado' : 'falhou'}`,
      );
      void error;
    } finally {
      clearTimeout(deadline);
      clearInterval(pulse);
      this.active = undefined;
      for (const key of pendingKeys)
        await db
          .query(
            'UPDATE video_remix_storage_cleanup SET not_before=NOW() WHERE storage_key=$1',
            [key],
          )
          .catch(() => {});
    }
  }
}
