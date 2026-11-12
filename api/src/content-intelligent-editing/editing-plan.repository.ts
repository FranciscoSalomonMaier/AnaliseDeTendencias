import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type { EditingPlan, PlanInput } from './editing-plan.schema';
@Injectable()
export class EditingPlanRepository {
  constructor(readonly db: PostgresDatabaseService) {}
  private query<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    values: unknown[],
    client?: PoolClient,
  ) {
    return client
      ? client.query<T>(sql, values)
      : this.db.query<T>(sql, values);
  }
  private map(r: Record<string, unknown>): EditingPlan {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      ownerId: String(r.owner_id),
      version: Number(r.version),
      revision: Number(r.revision),
      status: String(r.status),
      inputHash: String(r.input_hash),
      input: r.input as EditingPlan['input'],
      result: r.result as EditingPlan['result'],
      progress: Number(r.progress),
      cancelRequested: Boolean(r.cancel_requested),
      usage: r.usage as EditingPlan['usage'],
      error: r.error as string | null,
      previousEditing: r.previous_editing as EditingPlan['previousEditing'],
      appliedEditingRevision:
        r.applied_editing_revision === null
          ? null
          : Number(r.applied_editing_revision),
      createdAt: new Date(String(r.created_at)).toISOString(),
      updatedAt: new Date(String(r.updated_at)).toISOString(),
    };
  }
  async get(project: string, id: string, owner: string, client?: PoolClient) {
    const r = await this.query(
      'SELECT * FROM content_editing_plans WHERE project_id=$1 AND id=$2 AND owner_id=$3',
      [project, id, owner],
      client,
    );
    if (!r.rows[0]) throw new NotFoundException('Plano não encontrado.');
    return this.map(r.rows[0]);
  }
  async list(project: string, owner: string) {
    return (
      await this.db.query<Record<string, unknown>>(
        'SELECT * FROM content_editing_plans WHERE project_id=$1 AND owner_id=$2 ORDER BY version DESC LIMIT 100',
        [project, owner],
      )
    ).rows.map((r) => this.map(r));
  }
  async create(
    project: string,
    owner: string,
    input: PlanInput,
    inputHash: string,
    client: PoolClient,
  ) {
    const r = await client.query<Record<string, unknown>>(
      `INSERT INTO content_editing_plans(id,project_id,owner_id,version,status,input_hash,input) SELECT $1,$2,$3,COALESCE(MAX(version),0)+1,'PENDING',$4,$5::jsonb FROM content_editing_plans WHERE project_id=$2 RETURNING *`,
      [randomUUID(), project, owner, inputHash, JSON.stringify(input)],
    );
    return this.map(r.rows[0]);
  }
  async save(p: EditingPlan, client?: PoolClient) {
    await this.query(
      `UPDATE content_editing_plans SET status=$2,revision=$3,result=$4::jsonb,progress=$5,usage=$6::jsonb,error=$7,previous_editing=$8::jsonb,applied_editing_revision=$9,updated_at=NOW() WHERE id=$1`,
      [
        p.id,
        p.status,
        p.revision,
        JSON.stringify(p.result),
        p.progress,
        JSON.stringify(p.usage),
        p.error,
        JSON.stringify(p.previousEditing),
        p.appliedEditingRevision,
      ],
      client,
    );
  }
  async event(
    p: EditingPlan,
    action: string,
    details: unknown = {},
    client?: PoolClient,
  ) {
    await this.query(
      'INSERT INTO content_editing_plan_events(plan_id,action,revision,details) VALUES($1,$2,$3,$4::jsonb)',
      [p.id, action, p.revision, JSON.stringify(details)],
      client,
    );
  }
  async events(p: EditingPlan) {
    return (
      await this.db.query(
        'SELECT action,revision,details,created_at FROM content_editing_plan_events WHERE plan_id=$1 ORDER BY id',
        [p.id],
      )
    ).rows;
  }
  async cancel(p: EditingPlan) {
    await this.db.query(
      "UPDATE content_editing_plans SET cancel_requested=TRUE,status=CASE WHEN status='PENDING' THEN 'CANCELLED' ELSE status END,updated_at=NOW() WHERE id=$1 AND status IN ('PENDING','PROCESSING')",
      [p.id],
    );
  }
  async cache(owner: string, key: string) {
    return (
      await this.db.query(
        'SELECT result FROM content_editing_analysis_cache WHERE owner_id=$1 AND cache_key=$2',
        [owner, key],
      )
    ).rows[0]?.result as unknown;
  }
  async putCache(owner: string, key: string, result: unknown) {
    await this.db.query(
      'INSERT INTO content_editing_analysis_cache(owner_id,cache_key,result) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
      [owner, key, JSON.stringify(result)],
    );
  }
  async worker<T>(work: (client: PoolClient) => Promise<T>) {
    return this.db.withClient(async (client) => {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('content-intelligent-editing:worker',0)) acquired",
      );
      if (!lock.rows[0].acquired) return;
      try {
        return await work(client);
      } finally {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended('content-intelligent-editing:worker',0))",
        );
      }
    });
  }
  async next(client: PoolClient, owner: string) {
    // The advisory worker lock proves no other worker is processing. Interrupted paid
    // calls are not replayed automatically; the user can explicitly request a new plan.
    await client.query(
      "UPDATE content_editing_plans SET status=CASE WHEN cancel_requested THEN 'CANCELLED' ELSE 'FAILED' END,error='Análise interrompida. Solicite uma nova versão; resultados visuais concluídos estão no cache.',updated_at=NOW() WHERE status='PROCESSING' AND owner_id=$1",
      [owner],
    );
    const r = await client.query<Record<string, unknown>>(
      "UPDATE content_editing_plans SET status='PROCESSING',updated_at=NOW() WHERE id=(SELECT id FROM content_editing_plans WHERE status='PENDING' AND owner_id=$1 ORDER BY created_at LIMIT 1) RETURNING *",
      [owner],
    );
    return r.rows[0] ? this.map(r.rows[0]) : null;
  }
}
