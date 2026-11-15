import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RemixAnalysisService } from './remix-analysis.service';
import {
  storyHash,
  type StoryContext,
  type Evidence,
  type StorySql,
} from './remix-story.schema';
import type { SceneResult } from './remix-analysis.schema';
@Injectable()
export class RemixNarrativePlanner {
  constructor(private readonly analyses: RemixAnalysisService) {}
  async context(project: string, db?: PoolClient): Promise<StoryContext> {
    const p = await this.analyses.authorize(project);
    if (p.status !== 'DRAFT')
      throw new ConflictException(
        'O roteiro só pode ser alterado em projetos DRAFT.',
      );
    const query: StorySql = db ?? this.analyses.repo.db;
    const rows = await query.query<{
      id: string;
      analysis_id: string;
      source_id: string;
      file_id: string;
      scene_ids: string[];
      start_seconds: number;
      end_seconds: number;
      revision: number;
      description: string;
      justification: string;
      confidence: number;
      relevance: number;
      evidence_type: string;
      context: { topic: string; licensing: unknown };
    }>(
      `SELECT c.*,a.source_id,a.file_id,a.context FROM video_remix_segment_candidates c JOIN video_remix_analyses a ON a.id=c.analysis_id WHERE a.project_id=$1 AND a.status='COMPLETED' AND c.selected=true ORDER BY a.source_id,c.start_seconds,c.id`,
      [project],
    );
    if (!rows.rows.length)
      throw new BadRequestException(
        'Selecione trechos na Análise Inteligente antes de gerar o roteiro.',
      );
    if (rows.rows.length > 12)
      throw new BadRequestException(
        'Selecione no máximo 12 trechos para este roteiro.',
      );
    const evidence: Evidence[] = [];
    for (const row of rows.rows) {
      const current = await this.analyses.source(project, row.source_id);
      if (
        current.f.id !== row.file_id ||
        p.topic !== row.context.topic ||
        storyHash(current.s.licensing) !== storyHash(row.context.licensing)
      )
        throw new ConflictException(
          'Há análises selecionadas desatualizadas. Analise e selecione a fonte atual.',
        );
      const scenes = await query.query<{ id: string; result: SceneResult }>(
        'SELECT id,result FROM video_remix_scenes WHERE analysis_id=$1 AND id=ANY($2::uuid[]) ORDER BY ordinal',
        [row.analysis_id, row.scene_ids],
      );
      const frames = await query.query<{
        id: string;
        timestamp_seconds: number;
        storage_key: string;
      }>(
        `SELECT f.* FROM video_remix_scene_frames f JOIN video_remix_scenes s ON s.id=f.scene_id WHERE s.analysis_id=$1 AND s.id=ANY($2::uuid[]) AND f.timestamp_seconds BETWEEN $3 AND $4 ORDER BY f.timestamp_seconds LIMIT 6`,
        [row.analysis_id, row.scene_ids, row.start_seconds, row.end_seconds],
      );
      evidence.push({
        id: row.id,
        sourceId: row.source_id,
        fileId: row.file_id,
        analysisId: row.analysis_id,
        sceneIds: row.scene_ids,
        start: row.start_seconds,
        end: row.end_seconds,
        candidateRevision: row.revision,
        description: row.description,
        justification: row.justification,
        confidence: row.confidence,
        relevance: row.relevance,
        evidenceType: row.evidence_type,
        licensing: current.s.licensing,
        scenes: scenes.rows.slice(0, 4).map((s) => ({
          id: s.id,
          description: s.result.description.slice(0, 1000),
          actions: s.result.actions.slice(0, 6),
          events: s.result.events.slice(0, 6),
          uncertainty: s.result.uncertainty.slice(0, 500),
        })),
        frames: frames.rows.map((f) => ({
          id: f.id,
          timestamp: f.timestamp_seconds,
          key: f.storage_key,
        })),
      });
    }
    const context = {
      project: {
        id: p.id,
        topic: p.topic,
        description: p.description,
        mode: p.mode,
        language: p.narrationLanguage,
        targetDuration: p.targetDurationSeconds,
      },
      evidence,
    };
    return { ...context, hash: storyHash(context) };
  }
}
