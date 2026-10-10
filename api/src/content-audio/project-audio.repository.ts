import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import {
  defaultProjectAudio,
  ProjectAudioSettings,
} from './project-audio.schema';
@Injectable()
export class ProjectAudioRepository {
  constructor(private readonly db: PostgresDatabaseService) {}
  async get(id: string, client?: PoolClient): Promise<ProjectAudioSettings> {
    const sql =
      'SELECT settings FROM content_project_audio WHERE project_id=$1';
    const r = client
      ? await client.query<{ settings: ProjectAudioSettings }>(sql, [id])
      : await this.db.query<{ settings: ProjectAudioSettings }>(sql, [id]);
    return r.rows[0]?.settings ?? defaultProjectAudio();
  }
  async save(id: string, settings: ProjectAudioSettings, client: PoolClient) {
    await client.query(
      'INSERT INTO content_project_audio(project_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(project_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()',
      [id, JSON.stringify(settings)],
    );
  }
}
