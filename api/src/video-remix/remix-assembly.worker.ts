import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { readdir, stat, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { RemixAssemblyService } from './remix-assembly.service';
import { RemixAssemblyRenderer } from './remix-assembly.renderer';
import type { ExportJob } from './remix-assembly.schema';
@Injectable()
export class RemixAssemblyWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RemixAssemblyWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  private active?: AbortController;
  constructor(
    private readonly service: RemixAssemblyService,
    private readonly renderer: RemixAssemblyRenderer,
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
          'Fila de montagem indisponível. Verifique o banco e a migration 019.',
        ),
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async work() {
    const s = this.service;
    await s.db.withClient(async (db) => {
      const lock = await db.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('remix-assembly-worker',0)) ok",
      );
      if (!lock.rows[0].ok) return;
      try {
        await db.query(
          "UPDATE video_remix_exports SET status='FAILED',error_message='Processamento interrompido. Solicite uma nova renderização.',completed_at=NOW() WHERE status='RUNNING'",
        );
        for (const name of await readdir(s.settings.tempDir).catch(() => [])) {
          if (!/^remix-export-[A-Za-z0-9]{6}$/.test(name)) continue;
          const path = join(s.settings.tempDir, name);
          const info = await stat(path).catch(() => null);
          if (info && Date.now() - info.mtimeMs > 2 * 60 * 60 * 1000)
            await rm(path, { recursive: true, force: true });
        }
        const r = await db.query<ExportJob>(
          "UPDATE video_remix_exports SET status='RUNNING',started_at=NOW(),attempts=attempts+1 WHERE id=(SELECT id FROM video_remix_exports WHERE status='QUEUED' ORDER BY created_at LIMIT 1) RETURNING *",
        );
        const job = r.rows[0];
        if (!job) return;
        const abort = new AbortController();
        this.active = abort;
        let timedOut = false;
        const deadline = setTimeout(() => {
          timedOut = true;
          abort.abort();
        }, s.settings.timeoutMs);
        deadline.unref();
        const diskMonitor = setInterval(
          () =>
            void statfs(s.settings.tempDir)
              .then((d) => {
                if (
                  Number(d.bavail) * Number(d.bsize) <
                  Math.min(s.settings.minFreeBytes, 64 * 1024 * 1024)
                )
                  abort.abort();
              })
              .catch(() => {}),
          1500,
        );
        diskMonitor.unref();
        const pulse = setInterval(
          () =>
            void db
              .query<{ cancel_requested: boolean }>(
                'SELECT cancel_requested FROM video_remix_exports WHERE id=$1',
                [job.id],
              )
              .then((r) => {
                if (!r.rows[0] || r.rows[0].cancel_requested) abort.abort();
              })
              .catch(() => abort.abort()),
          750,
        );
        pulse.unref();
        const key = `remix-export/${job.project_id}/${job.id}.mp4`;
        try {
          const timeline = await s.row(job.project_id, job.timeline_id);
          await s.fresh(timeline);
          if (timeline.data.issues.length)
            throw new Error('Timeline inválida.');
          const result = await this.renderer.render(
            job,
            timeline,
            abort.signal,
            async (stage, completed, total) => {
              if (abort.signal.aborted) throw new Error('Cancelado');
              await db.query(
                "UPDATE video_remix_exports SET progress=$2 WHERE id=$1 AND status='RUNNING'",
                [job.id, { stage, completed, total }],
              );
            },
          );
          await s.fresh(timeline);
          if (abort.signal.aborted) throw new Error('Cancelado');
          await db.query('BEGIN');
          try {
            const done = await db.query(
              "UPDATE video_remix_exports SET status='COMPLETED',storage_key=$2,byte_size=$3,duration_seconds=$4,width=$5,height=$6,metadata=$7,progress=$8,completed_at=NOW() WHERE id=$1 AND cancel_requested=false RETURNING id",
              [
                job.id,
                result.key,
                result.byteSize,
                result.duration,
                result.width,
                result.height,
                { ...job.metadata, ...result.metadata },
                { stage: 'COMPLETED', completed: 1, total: 1 },
              ],
            );
            if (!done.rowCount) throw new Error('Cancelado');
            await db.query(
              'DELETE FROM video_remix_storage_cleanup WHERE storage_key=$1',
              [key],
            );
            await db.query('COMMIT');
          } catch (e) {
            await db.query('ROLLBACK');
            throw e;
          }
        } catch (error) {
          const state = await db.query<{ cancel_requested: boolean }>(
            'SELECT cancel_requested FROM video_remix_exports WHERE id=$1',
            [job.id],
          );
          const cancelled = state.rows[0]?.cancel_requested;
          await db.query(
            'UPDATE video_remix_exports SET status=$2,error_message=$3,completed_at=NOW() WHERE id=$1',
            [
              job.id,
              cancelled ? 'CANCELLED' : 'FAILED',
              cancelled
                ? 'Renderização cancelada.'
                : timedOut
                  ? 'Tempo limite de renderização atingido.'
                  : 'Não foi possível renderizar. Verifique os arquivos, espaço livre, limites e a versão atual do roteiro.',
            ],
          );
          this.logger.warn(
            `Montagem ${job.id}: ${error instanceof Error ? error.stack : 'falha'}`,
          );
        } finally {
          clearTimeout(deadline);
          clearInterval(pulse);
          clearInterval(diskMonitor);
          this.active = undefined;
          await db.query(
            'UPDATE video_remix_storage_cleanup SET not_before=NOW() WHERE storage_key=$1',
            [key],
          );
        }
      } finally {
        await db.query(
          "SELECT pg_advisory_unlock(hashtextextended('remix-assembly-worker',0))",
        );
      }
    });
  }
}
