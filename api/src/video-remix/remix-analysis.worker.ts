import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  statfs,
  readdir,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { RemixAnalysisService } from './remix-analysis.service';
import { RemixAnalysisMedia } from './remix-analysis.media';
import { VideoSceneAnalysisService } from './video-scene-analysis.service';
import {
  segmentVideo,
  validSceneResult,
  type AnalysisJob,
  type SceneResult,
} from './remix-analysis.schema';
@Injectable()
export class RemixAnalysisWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RemixAnalysisWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  private active?: AbortController;
  constructor(
    private readonly service: RemixAnalysisService,
    private readonly media: RemixAnalysisMedia,
    private readonly vision: VideoSceneAnalysisService,
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
          'Fila de análise indisponível. Verifique o banco e a migration 017.',
        ),
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async work() {
    await this.service.repo.db.withClient(async (db) => {
      const lock = await db.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('remix-analysis-worker',0)) ok",
      );
      if (!lock.rows[0].ok) return;
      try {
        for (const name of await readdir(this.service.settings.tempDir).catch(
          () => [],
        )) {
          if (!/^analysis-[a-zA-Z0-9]+$/.test(name)) continue;
          const path = join(this.service.settings.tempDir, name),
            info = await stat(path).catch(() => null);
          if (info && Date.now() - info.mtimeMs > 2 * 60 * 60 * 1000)
            await rm(path, { recursive: true, force: true });
        }
        // A single session lock owns all processing; a lost process never resumes paid calls automatically.
        await db.query(
          "UPDATE video_remix_analyses SET status='FAILED',error_message='Processamento interrompido. Revise o consumo antes de reprocessar.',completed_at=NOW() WHERE status='RUNNING'",
        );
        const next = await db.query<AnalysisJob>(
          "UPDATE video_remix_analyses SET status='RUNNING',attempts=attempts+1,started_at=NOW(),error_message=NULL WHERE id=(SELECT id FROM video_remix_analyses WHERE status='QUEUED' ORDER BY created_at LIMIT 1) RETURNING *",
        );
        if (next.rows[0]) await this.execute(next.rows[0], db);
      } finally {
        await db.query(
          "SELECT pg_advisory_unlock(hashtextextended('remix-analysis-worker',0))",
        );
      }
    });
  }
  private async execute(job: AnalysisJob, db: PoolClient) {
    const s = this.service,
      storage = s.files.storage,
      c = job.config,
      abort = new AbortController();
    this.active = abort;
    let dir: string | undefined;
    const keys: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const deadline = setTimeout(() => abort.abort(), 30 * 60 * 1000);
    deadline.unref();
    const pulse = setInterval(() => {
      void db
        .query<{ cancel_requested: boolean }>(
          'SELECT cancel_requested FROM video_remix_analyses WHERE id=$1',
          [job.id],
        )
        .then((r) => {
          if (!r.rows[0] || r.rows[0].cancel_requested) abort.abort();
        })
        .catch(() => abort.abort());
    }, 1000);
    pulse.unref();
    const check = () => {
      if (abort.signal.aborted)
        throw new Error('Análise cancelada ou tempo limite atingido.');
    };
    const progress = async (stage: string, completed = 0, total = 0) => {
      check();
      await db.query(
        'UPDATE video_remix_analyses SET progress=$2 WHERE id=$1',
        [job.id, { stage, completed, total }],
      );
      this.logger.log(`Análise ${job.id}: ${stage} ${completed}/${total}`);
    };
    const consume = async (u: typeof usage) => {
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.totalTokens += u.totalTokens;
      await db.query('UPDATE video_remix_analyses SET usage=$2 WHERE id=$1', [
        job.id,
        usage,
      ]);
      if (
        c.maxUsd !== null &&
        c.inputUsd !== null &&
        c.outputUsd !== null &&
        (usage.inputTokens * c.inputUsd + usage.outputTokens * c.outputUsd) /
          1e6 >
          c.maxUsd
      )
        throw new Error('Consumo reportado atingiu o limite configurado.');
    };
    const call = async <T>(fn: () => Promise<T>): Promise<T> => {
      check();
      const current = await s.source(job.project_id, job.source_id);
      if (
        current.s.importedFileId !== job.file_id ||
        current.p.topic !== job.context.topic ||
        JSON.stringify(current.s.licensing) !==
          JSON.stringify(job.context.licensing)
      )
        throw new Error('Fonte ou autorização alteradas.');
      try {
        return await fn();
      } catch (e) {
        if (
          e instanceof HttpException &&
          [429, 502, 503, 504].includes(e.getStatus()) &&
          !abort.signal.aborted
        ) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 1000);
            abort.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                resolve();
              },
              { once: true },
            );
          });
          check();
          return fn();
        }
        throw e;
      }
    };
    try {
      await progress('PREPARING');
      const { p, s: source, f } = await s.source(job.project_id, job.source_id);
      if (
        source.importedFileId !== job.file_id ||
        p.topic !== job.context.topic ||
        JSON.stringify(source.licensing) !==
          JSON.stringify(job.context.licensing)
      )
        throw new Error(
          'Fonte, autorização ou tema alterados. Inicie uma nova análise.',
        );
      if (f.width * f.height > 3840 * 2160)
        throw new Error('Resolução acima do limite de análise.');
      if (!storage.copyTo)
        throw new Error('Storage não suporta cópia segura para análise.');
      await mkdir(s.settings.tempDir, { recursive: true, mode: 0o700 });
      const disk = await statfs(s.settings.tempDir);
      if (
        Number(disk.bavail) * Number(disk.bsize) <
        Number(f.byte_size) + 256 * 1024 * 1024
      )
        throw new Error('Espaço livre insuficiente para análise.');
      dir = await mkdtemp(join(s.settings.tempDir, 'analysis-'));
      await chmod(dir, 0o700);
      const path = join(dir, `input.${f.extension}`);
      await storage.copyTo(f.storage_key, path);
      await chmod(path, 0o600);
      const metadata = await this.media.metadata(path, abort.signal);
      if (
        Math.abs(metadata.duration - f.duration_seconds) > 1 ||
        metadata.width !== f.width ||
        metadata.height !== f.height
      )
        throw new Error(
          'Integridade dos metadados do arquivo alterada. Importe novamente.',
        );
      const duration = Math.min(metadata.duration, c.maxDuration);
      await db.query(
        'UPDATE video_remix_analyses SET metadata=$2 WHERE id=$1',
        [
          job.id,
          {
            ...metadata,
            fps: f.fps,
            byteSize: Number(f.byte_size),
            sha256: await this.media.hash(path),
            analyzedDuration: duration,
            truncated: duration < metadata.duration,
          },
        ],
      );
      await progress('DETECTING');
      const cuts = await this.media.cuts(path, duration, c, abort.signal);
      const segments = segmentVideo(duration, cuts, c);
      const completed: Array<{
        id: string;
        start: number;
        end: number;
        result: SceneResult;
      }> = [];
      for (const [ordinal, segment] of segments.entries()) {
        await progress('EXTRACTING', ordinal, segments.length);
        const frames = await this.media.frames(
          path,
          dir,
          segment,
          c,
          abort.signal,
        );
        await progress('ANALYZING', ordinal, segments.length);
        const result = await call(() =>
          this.vision.scene(
            job.context.topic,
            job.context.language,
            segment,
            frames,
            c,
            abort.signal,
          ),
        );
        await consume(result.usage);
        result.data = validSceneResult(
          result.data,
          segment,
          frames.map((f) => f.timestamp),
        );
        check();
        const id = randomUUID(),
          saved: Array<{
            id: string;
            key: string;
            timestamp: number;
            data: Buffer;
            width: number;
            height: number;
            hash: string;
          }> = [];
        for (const frame of frames) {
          const frameId = randomUUID(),
            key = `remix-analysis/${job.project_id}/${job.id}/${frameId}.jpg`;
          keys.push(key);
          await db.query(
            "INSERT INTO video_remix_storage_cleanup(storage_key,not_before) VALUES($1,NOW()+interval '1 hour') ON CONFLICT DO NOTHING",
            [key],
          );
          await storage.save(key, frame.data);
          saved.push({ ...frame, id: frameId, key });
        }
        await db.query('BEGIN');
        try {
          await db.query(
            'INSERT INTO video_remix_scenes(id,analysis_id,ordinal,start_seconds,end_seconds,result) VALUES($1,$2,$3,$4,$5,$6)',
            [id, job.id, ordinal, segment.start, segment.end, result.data],
          );
          for (const frame of saved) {
            await db.query(
              'INSERT INTO video_remix_scene_frames(id,scene_id,timestamp_seconds,storage_key,width,height,byte_size,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [
                frame.id,
                id,
                frame.timestamp,
                frame.key,
                frame.width,
                frame.height,
                frame.data.length,
                frame.hash,
              ],
            );
            await db.query(
              'DELETE FROM video_remix_storage_cleanup WHERE storage_key=$1',
              [frame.key],
            );
          }
          await db.query('COMMIT');
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        }
        completed.push({
          id,
          start: segment.start,
          end: segment.end,
          result: result.data,
        });
        await progress('ANALYZING', ordinal + 1, segments.length);
      }
      await progress('RELEVANCE', 0, completed.length);
      const sequences =
        completed.length > 1
          ? await call(() =>
              this.vision.sequences(
                job.context.topic,
                completed.map((scene) => ({
                  id: scene.id,
                  start: scene.start,
                  end: scene.end,
                  description: scene.result.description.slice(0, 1000),
                  actions: scene.result.actions.slice(0, 5),
                  events: scene.result.events.slice(0, 5),
                  confidence: scene.result.confidence,
                  relevance: scene.result.relevance,
                  uncertainty: scene.result.uncertainty.slice(0, 500),
                })),
                c,
                abort.signal,
              ),
            )
          : null;
      if (sequences) await consume(sequences.usage);
      const current = await s.source(job.project_id, job.source_id);
      if (
        current.s.importedFileId !== job.file_id ||
        current.p.topic !== job.context.topic ||
        JSON.stringify(current.s.licensing) !==
          JSON.stringify(job.context.licensing)
      )
        throw new Error(
          'Fonte, autorização ou tema alterados durante a análise.',
        );
      check();
      await db.query('BEGIN');
      try {
        for (const scene of completed)
          await this.candidate(
            db,
            job,
            [scene.id],
            scene.start,
            scene.end,
            scene.result.description,
            scene.result.justification,
            scene.result.relevance,
            scene.result.confidence,
            scene.result.events.some((e) => e.evidence === 'INFERRED')
              ? 'INFERRED'
              : scene.result.events.some((e) => e.evidence === 'UNCONFIRMED')
                ? 'UNCONFIRMED'
                : 'OBSERVED',
          );
        for (const sequence of sequences?.data.sequences ?? []) {
          const indices = sequence.sceneIds.map((id) =>
            completed.findIndex((s) => s.id === id),
          );
          if (
            indices.some((n, i) => n < 0 || (i > 0 && n !== indices[i - 1] + 1))
          )
            throw new Error('A IA retornou sequência sem continuidade válida.');
          const first = completed[indices[0]],
            last = completed[indices.at(-1)!];
          await this.candidate(
            db,
            job,
            sequence.sceneIds,
            first.start,
            last.end,
            sequence.description,
            sequence.justification,
            sequence.relevance,
            sequence.confidence,
            sequence.evidence,
          );
        }
        await db.query(
          "UPDATE video_remix_analyses SET status='COMPLETED',completed_at=NOW(),progress=$2 WHERE id=$1 AND cancel_requested=false",
          [
            job.id,
            {
              stage: 'COMPLETED',
              completed: completed.length,
              total: completed.length,
            },
          ],
        );
        check();
        const state = await db.query<{ status: string }>(
          'SELECT status FROM video_remix_analyses WHERE id=$1',
          [job.id],
        );
        if (state.rows[0]?.status !== 'COMPLETED')
          throw new Error('Análise cancelada.');
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    } catch (error) {
      const flag = await db.query<{ cancel_requested: boolean }>(
        'SELECT cancel_requested FROM video_remix_analyses WHERE id=$1',
        [job.id],
      );
      const cancelled = flag.rows[0]?.cancel_requested;
      const message = cancelled
        ? 'Análise cancelada.'
        : abort.signal.aborted
          ? 'Processamento interrompido ou tempo limite atingido. Revise o consumo antes de reprocessar.'
          : error instanceof HttpException
            ? 'Falha no provedor de IA. Verifique modelo, chave, saldo e disponibilidade.'
            : 'Não foi possível concluir a análise. Verifique o arquivo e as configurações; os resultados parciais e o consumo foram preservados.';
      await db.query(
        'UPDATE video_remix_analyses SET status=$2,error_message=$3,completed_at=NOW(),usage=$4 WHERE id=$1',
        [job.id, cancelled ? 'CANCELLED' : 'FAILED', message, usage],
      );
      this.logger.warn(
        `Análise ${job.id}: ${cancelled ? 'cancelada' : 'falhou'}`,
      );
    } finally {
      clearInterval(pulse);
      clearTimeout(deadline);
      this.active = undefined;
      for (const key of keys) {
        await db
          .query(
            'UPDATE video_remix_storage_cleanup SET not_before=NOW() WHERE storage_key=$1',
            [key],
          )
          .catch(() => {});
      }
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  private async candidate(
    db: PoolClient,
    j: AnalysisJob,
    ids: string[],
    start: number,
    end: number,
    description: string,
    justification: string,
    relevance: number,
    confidence: number,
    evidence: string,
  ) {
    await db.query(
      'INSERT INTO video_remix_segment_candidates(id,analysis_id,scene_ids,start_seconds,end_seconds,description,justification,relevance,confidence,evidence_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        randomUUID(),
        j.id,
        ids,
        start,
        end,
        description,
        justification,
        relevance,
        confidence,
        evidence,
      ],
    );
  }
}
