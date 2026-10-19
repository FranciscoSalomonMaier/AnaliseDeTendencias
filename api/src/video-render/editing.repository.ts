import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import {
  defaultEditing,
  editingSchema,
  EditingSettings,
} from './editing-settings';
@Injectable()
export class EditingRepository {
  constructor(private readonly db: PostgresDatabaseService) {}
  async get(id: string, client?: PoolClient): Promise<EditingSettings> {
    const sql =
      'SELECT settings FROM content_project_editing WHERE project_id=$1';
    const result = client
      ? await client.query<{ settings: unknown }>(sql, [id])
      : await this.db.query<{ settings: unknown }>(sql, [id]);
    return result.rows[0]
      ? editingSchema.parse(result.rows[0].settings)
      : defaultEditing();
  }
  async save(id: string, settings: EditingSettings, client: PoolClient) {
    await client.query(
      'INSERT INTO content_project_editing(project_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(project_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()',
      [id, JSON.stringify(settings)],
    );
  }
}
