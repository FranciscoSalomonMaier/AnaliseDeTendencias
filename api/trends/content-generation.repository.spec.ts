import { NotFoundException } from '@nestjs/common';
import { PostgresDatabaseService } from 'src/database/postgres-database.service';
import { ContentGenerationRepository } from './content-generation.repository';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

const generationId = '6c6f8369-1cb2-4a4a-a748-3e4ca7edb923';
const ideaId = '477b86db-3fee-47c1-b692-f35b1a8d2f6d';
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const idea = {
  ideaId,
  generationId,
  trendId: 'topic',
  regionCode: 'BR',
  language: 'pt-BR',
  title: 'An idea',
  hook: 'A compelling hook',
  angle: 'An original narrative angle',
  summary: 'A summary based on the trend evidence.',
  targetAudience: null,
};
const script = {
  title: 'Script',
  hook: 'Opening hook',
  introduction: 'Introduction',
  sections: [
    { title: 'Section', narration: 'Narration text.' },
    { title: 'Next', narration: 'More narration.' },
  ],
  conclusion: 'Conclusion',
  estimatedDurationSeconds: 60,
  researchRequired: false,
  researchNotes: [],
};

function setup() {
  const query = jest
    .fn<Promise<{ rows: unknown[]; rowCount: number }>, [string, unknown[]]>()
    .mockResolvedValue({ rows: [], rowCount: 1 });
  const repository = new ContentGenerationRepository({
    query,
  } as unknown as PostgresDatabaseService);
  return { repository, query };
}

describe('ContentGenerationRepository', () => {
  it('persists the trend snapshot, generated ideas, and initial token usage', async () => {
    const { repository, query } = setup();
    const trendSnapshot = { trend: { id: 'topic' } } as never;
    await repository.createRun({
      generationId,
      trendId: 'topic',
      regionCode: 'BR',
      language: 'pt-BR',
      trendSnapshot,
      ideas: [idea] as never,
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    expect(query.mock.calls[0][0]).toContain(
      'INSERT INTO content_generation_runs',
    );
    expect(query.mock.calls[0][1]).toContain(JSON.stringify([idea]));
    expect(query.mock.calls[0][1]).toContain(10);
    expect(query.mock.calls[0][1]).toContain(15);
  });

  it('loads persisted snapshots and script between generation stages', async () => {
    const { repository, query } = setup();
    query.mockResolvedValueOnce({
      rows: [
        {
          generation_id: generationId,
          trend_id: 'topic',
          region_code: 'BR',
          language: 'pt-BR',
          trend_snapshot: { trend: { id: 'topic' } },
          ideas: [idea],
          selected_idea: idea,
          script,
          video_plan: null,
          production_approved: false,
        },
      ],
      rowCount: 1,
    });

    await expect(repository.getContext(generationId)).resolves.toEqual({
      generationId,
      trendId: 'topic',
      regionCode: 'BR',
      language: 'pt-BR',
      trendSnapshot: { trend: { id: 'topic' } },
      ideas: [idea],
      selectedIdea: idea,
      script,
      videoPlan: undefined,
      productionApproved: false,
    });
  });

  it('lists saved ideas grouped with their scripts and scenes', async () => {
    const { repository, query } = setup();
    const createdAt = new Date('2026-10-01T10:00:00.000Z');
    const updatedAt = new Date('2026-10-02T10:00:00.000Z');
    const videoPlan = {
      title: 'Narrated story',
      totalEstimatedDurationSeconds: 60,
      scenes: [],
    };
    query
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            generation_id: generationId,
            trend_id: 'topic',
            region_code: 'BR',
            language: 'pt-BR',
            trend_snapshot: { trend: { topic: 'Video trend' } },
            ideas: [idea],
            selected_idea: idea,
            script,
            video_plan: videoPlan,
            production_approved: false,
            created_at: createdAt,
            updated_at: updatedAt,
          },
        ],
        rowCount: 1,
      });

    await expect(
      repository.listRuns({ limit: 20, offset: 0 }),
    ).resolves.toEqual({
      total: 1,
      items: [
        {
          generationId,
          trendId: 'topic',
          regionCode: 'BR',
          language: 'pt-BR',
          trendSnapshot: { trend: { topic: 'Video trend' } },
          ideas: [idea],
          selectedIdea: idea,
          script,
          videoPlan,
          productionApproved: false,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
    });
  });

  it('rejects updates for missing generation records', async () => {
    const { repository, query } = setup();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(
      repository.saveScript(generationId, idea as never, script, usage),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('saves reviewed edits without adding token usage', async () => {
    const { repository, query } = setup();
    const plan = {
      title: 'Reviewed',
      totalEstimatedDurationSeconds: 8,
      scenes: [
        {
          order: 1,
          narration: 'Reviewed narration.',
          visualDescription: 'A calm establishing view.',
          imagePrompt: 'cinematic wide establishing shot, natural light',
          estimatedDurationSeconds: 8,
        },
      ],
    };

    await repository.saveReviewedPlan(generationId, script, plan, true);

    expect(query.mock.calls[0][0]).toContain('video_plan = $3::jsonb');
    expect(query.mock.calls[0][1]).toEqual([
      generationId,
      JSON.stringify(script),
      JSON.stringify(plan),
      true,
    ]);
  });

  it('saves reviewed script without changing accumulated usage', async () => {
    const { repository, query } = setup();

    await repository.saveReviewedScript(generationId, ideaId, script);

    expect(query.mock.calls[0][0]).toContain('video_plan = NULL');
    expect(query.mock.calls[0][1]).toEqual([
      generationId,
      ideaId,
      JSON.stringify(script),
    ]);
  });

  it('persists an idea selection and invalidates the derived script and scenes', async () => {
    const { repository, query } = setup();

    await repository.saveSelectedIdea(generationId, idea);

    expect(query.mock.calls[0][0]).toContain('selected_idea = $2::jsonb');
    expect(query.mock.calls[0][0]).toContain('script = NULL');
    expect(query.mock.calls[0][0]).toContain('video_plan = NULL');
    expect(query.mock.calls[0][1]).toEqual([
      generationId,
      JSON.stringify(idea),
    ]);
  });
});
