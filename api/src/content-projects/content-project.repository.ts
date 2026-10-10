import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { ContentProject, ProjectConfig } from './content-project.schema';
interface Row {
  generation_id: string;
  project_config: ContentProject['config'];
  project_status: ContentProject['status'];
  project_revision: number;
  ideas: ContentProject['ideas'];
  selected_idea: ContentProject['selectedIdea'];
  script: ContentProject['script'];
  video_plan: { scenes: ContentProject['scenes'] } | null;
  script_stale: boolean;
  scenes_stale: boolean;
  project_usage: ContentProject['usage'];
  created_at: Date;
  updated_at: Date;
}
function mapRow(r: Row): ContentProject {
  return {
    id: r.generation_id,
    config: r.project_config,
    status: r.project_status,
    revision: r.project_revision,
    ideas: r.ideas,
    selectedIdea: r.selected_idea,
    script: r.script,
    scenes: r.video_plan?.scenes ?? [],
    scriptStale: r.script_stale,
    scenesStale: r.scenes_stale,
    usage: r.project_usage,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
@Injectable()
export class ContentProjectRepository {
  constructor(private readonly db: PostgresDatabaseService) {}
  async create(config: ProjectConfig) {
    const id = randomUUID();
    const result = await this.db.query<Row>(
      `INSERT INTO content_generation_runs(generation_id,trend_id,region_code,language,trend_snapshot,ideas,provider,model,project_config)
   VALUES($1,$2,'BR',$3,'{}'::jsonb,'[]'::jsonb,'','',$4::jsonb) RETURNING *`,
      [
        id,
        config.reference?.id ?? `manual:${id}`,
        config.language,
        JSON.stringify(config),
      ],
    );
    return mapRow(result.rows[0]);
  }
  async list(limit = 50, offset = 0) {
    const result = await this.db.query<Row>(
      'SELECT * FROM content_generation_runs WHERE project_config IS NOT NULL ORDER BY updated_at DESC,generation_id LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return { items: result.rows.map(mapRow), limit, offset };
  }
  async get(id: string, client?: PoolClient) {
    const query =
      'SELECT * FROM content_generation_runs WHERE generation_id=$1 AND project_config IS NOT NULL';
    const result = client
      ? await client.query<Row>(query, [id])
      : await this.db.query<Row>(query, [id]);
    if (!result.rows[0]) throw new NotFoundException('Projeto não encontrado');
    return mapRow(result.rows[0]);
  }
  async locked<T>(
    id: string,
    work: (p: ContentProject, client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.db.withClient(async (client) => {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('content-project:'||$1,0)) acquired",
        [id],
      );
      if (!result.rows[0].acquired)
        throw new ConflictException(
          'Já existe uma operação em andamento neste projeto',
        );
      try {
        return await work(await this.get(id, client), client);
      } finally {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended('content-project:'||$1,0))",
          [id],
        );
      }
    });
  }
  async save(p: ContentProject, client: PoolClient) {
    const result = await client.query<Row>(
      `UPDATE content_generation_runs SET project_config=$2::jsonb,project_status=$3,project_revision=project_revision+1,
   ideas=$4::jsonb,selected_idea=$5::jsonb,script=$6::jsonb,video_plan=$7::jsonb,script_stale=$8,scenes_stale=$9,project_usage=$10::jsonb,
   language=$11,production_approved=$12,updated_at=NOW()
   WHERE generation_id=$1 AND project_config IS NOT NULL AND project_revision=$13 RETURNING *`,
      [
        p.id,
        JSON.stringify(p.config),
        p.status,
        JSON.stringify(p.ideas),
        JSON.stringify(p.selectedIdea),
        JSON.stringify(p.script),
        p.scenes.length
          ? JSON.stringify({
              title: p.script?.title ?? p.config.topic,
              scenes: p.scenes,
              totalEstimatedDurationSeconds: p.scenes.reduce(
                (sum, s) => sum + s.estimatedDurationSeconds,
                0,
              ),
            })
          : null,
        p.scriptStale,
        p.scenesStale,
        JSON.stringify(p.usage),
        p.config.language,
        p.status === 'SCENES_APPROVED',
        p.revision,
      ],
    );
    if (!result.rows[0])
      throw new ConflictException(
        'Projeto alterado em outra janela. Reabra para continuar.',
      );
    return mapRow(result.rows[0]);
  }
}
