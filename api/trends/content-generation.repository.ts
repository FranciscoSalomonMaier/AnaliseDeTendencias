import { Injectable, NotFoundException } from '@nestjs/common';
import { PostgresDatabaseService } from 'src/database/postgres-database.service';
import { LlmUsage } from 'src/ai/llm.provider';
import {
  GeneratedScript,
  GeneratedVideoPlan,
  PersistedContentIdea,
} from 'src/ai/content-generation/content-generation.schema';
import { TopicCluster } from './interfaces/topic-cluster/topic-cluster.interface';

export interface CreateContentGenerationRun {
  generationId: string;
  trendId: string;
  regionCode: string;
  language: string;
  trendSnapshot: {
    trend: TopicCluster;
    aiAnalysis?: unknown;
    referenceVideo?: TopicCluster['items'][number];
  };
  ideas: PersistedContentIdea[];
  provider: string;
  model: string;
  usage: LlmUsage;
}

export interface ContentGenerationContext {
  generationId: string;
  trendId: string;
  regionCode: string;
  language: string;
  trendSnapshot: CreateContentGenerationRun['trendSnapshot'];
  ideas: PersistedContentIdea[];
  selectedIdea?: PersistedContentIdea;
  script?: GeneratedScript;
  videoPlan?: GeneratedVideoPlan;
  productionApproved: boolean;
}

export interface ContentGenerationListItem extends ContentGenerationContext {
  createdAt: string;
  updatedAt: string;
}

interface ContentGenerationRow {
  generation_id: string;
  trend_id: string;
  region_code: string;
  language: string;
  trend_snapshot: CreateContentGenerationRun['trendSnapshot'];
  ideas: PersistedContentIdea[];
  selected_idea: PersistedContentIdea | null;
  script: GeneratedScript | null;
  video_plan: GeneratedVideoPlan | null;
  production_approved: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class ContentGenerationRepository {
  constructor(private readonly database: PostgresDatabaseService) {}

  async getContext(generationId: string): Promise<ContentGenerationContext> {
    const result = await this.database.query<ContentGenerationRow>(
      `SELECT generation_id, trend_id, region_code, language,
              trend_snapshot, ideas, selected_idea, script, video_plan,
              production_approved
       FROM content_generation_runs WHERE generation_id = $1`,
      [generationId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('A geração de conteúdo não foi encontrada');
    }
    return {
      generationId: row.generation_id,
      trendId: row.trend_id,
      regionCode: row.region_code.trim(),
      language: row.language,
      trendSnapshot: row.trend_snapshot,
      ideas: row.ideas,
      selectedIdea: row.selected_idea ?? undefined,
      script: row.script ?? undefined,
      videoPlan: row.video_plan ?? undefined,
      productionApproved: row.production_approved,
    };
  }

  async listRuns(options: {
    regionCode?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ContentGenerationListItem[]; total: number }> {
    const countResult = await this.database.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM content_generation_runs
       WHERE ($1::text IS NULL OR region_code = $1)`,
      [options.regionCode ?? null],
    );
    const result = await this.database.query<ContentGenerationRow>(
      `SELECT generation_id, trend_id, region_code, language,
              trend_snapshot, ideas, selected_idea, script, video_plan,
              production_approved, created_at, updated_at
       FROM content_generation_runs
       WHERE ($1::text IS NULL OR region_code = $1)
       ORDER BY updated_at DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [options.regionCode ?? null, options.limit, options.offset],
    );
    return {
      items: result.rows.map((row) => ({
        generationId: row.generation_id,
        trendId: row.trend_id,
        regionCode: row.region_code.trim(),
        language: row.language,
        trendSnapshot: row.trend_snapshot,
        ideas: row.ideas,
        selectedIdea: row.selected_idea ?? undefined,
        script: row.script ?? undefined,
        videoPlan: row.video_plan ?? undefined,
        productionApproved: row.production_approved,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  }

  async createRun(run: CreateContentGenerationRun): Promise<void> {
    await this.database.query(
      `INSERT INTO content_generation_runs
       (generation_id, trend_id, region_code, language, trend_snapshot, ideas,
        provider, model, input_tokens, output_tokens, total_tokens)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)`,
      [
        run.generationId,
        run.trendId,
        run.regionCode,
        run.language,
        JSON.stringify(run.trendSnapshot),
        JSON.stringify(run.ideas),
        run.provider,
        run.model,
        run.usage.inputTokens,
        run.usage.outputTokens,
        run.usage.totalTokens,
      ],
    );
  }

  async saveSelectedIdea(
    generationId: string,
    idea: PersistedContentIdea,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE content_generation_runs SET
         selected_idea = $2::jsonb,
         script = NULL,
         video_plan = NULL,
         production_approved = FALSE,
         updated_at = NOW()
       WHERE generation_id = $1 AND ideas @> jsonb_build_array($2::jsonb)`,
      [generationId, JSON.stringify(idea)],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('A ideia não pertence a esta geração');
    }
  }

  async saveScript(
    generationId: string,
    idea: PersistedContentIdea,
    script: GeneratedScript,
    usage: LlmUsage,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE content_generation_runs SET
         selected_idea = $2::jsonb,
         script = $3::jsonb,
         video_plan = NULL,
         production_approved = FALSE,
         input_tokens = input_tokens + $4,
         output_tokens = output_tokens + $5,
         total_tokens = total_tokens + $6,
         updated_at = NOW()
        WHERE generation_id = $1 AND ideas @> jsonb_build_array($2::jsonb)`,
      [
        generationId,
        JSON.stringify(idea),
        JSON.stringify(script),
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
      ],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('A geração de conteúdo não foi encontrada');
    }
  }

  async saveReviewedScript(
    generationId: string,
    ideaId: string,
    script: GeneratedScript,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE content_generation_runs SET
         script = $3::jsonb,
         video_plan = NULL,
         production_approved = FALSE,
         updated_at = NOW()
       WHERE generation_id = $1 AND selected_idea->>'ideaId' = $2`,
      [generationId, ideaId, JSON.stringify(script)],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('A ideia selecionada não foi encontrada');
    }
  }

  async saveVideoPlan(
    generationId: string,
    plan: GeneratedVideoPlan,
    usage: LlmUsage,
    script: GeneratedScript,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE content_generation_runs SET
         video_plan = $2::jsonb,
         script = $3::jsonb,
         production_approved = FALSE,
         input_tokens = input_tokens + $4,
         output_tokens = output_tokens + $5,
         total_tokens = total_tokens + $6,
         updated_at = NOW()
       WHERE generation_id = $1`,
      [
        generationId,
        JSON.stringify(plan),
        JSON.stringify(script),
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
      ],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('A geração de conteúdo não foi encontrada');
    }
  }

  async saveReviewedPlan(
    generationId: string,
    script: GeneratedScript,
    plan: GeneratedVideoPlan,
    approved: boolean,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE content_generation_runs SET
         script = $2::jsonb,
         video_plan = $3::jsonb,
         production_approved = $4,
         updated_at = NOW()
       WHERE generation_id = $1 AND selected_idea IS NOT NULL`,
      [generationId, JSON.stringify(script), JSON.stringify(plan), approved],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('A geração de conteúdo não foi encontrada');
    }
  }
}
