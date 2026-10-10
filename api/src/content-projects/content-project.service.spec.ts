jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { ContentProjectService } from './content-project.service';
import { ContentProjectRepository } from './content-project.repository';
import { ContentProjectGenerationService } from './content-project-generation.service';
import {
  ContentProject,
  ProjectConfigSchema,
  NARRATION_WORDS_PER_MINUTE,
} from './content-project.schema';
import { LlmProvider } from '../ai/llm.provider';
import { AiAnalysisService } from '../ai/ai-analysis.service';
import { projectPrompt } from '../ai/content-generation/prompts/content-project.prompt';

const config = ProjectConfigSchema.parse({ topic: 'História do voo MH370' });
const idea = {
  title: 'O desaparecimento',
  hook: 'Um mistério que permanece',
  angle: 'Documentário e contexto',
  summary: 'Investigar os fatos conhecidos sem inventar explicações',
  targetAudience: null,
};
const script = {
  title: 'O desaparecimento',
  hook: 'Um mistério que permanece',
  introduction: 'Introdução documental',
  sections: [
    { title: 'Contexto', narration: 'Narração dos fatos conhecidos' },
    { title: 'Investigação', narration: 'Investigações e suas limitações' },
  ],
  conclusion: 'Conclusão sem especular',
  estimatedDurationSeconds: 300,
  researchRequired: true,
  researchNotes: ['Verificar datas'],
};
const scenes = [
  {
    order: 1,
    narration: 'Narração dos fatos conhecidos',
    visualDescription: 'Aeroporto durante a noite',
    imagePrompt: 'Dark documentary airport at night',
    estimatedDurationSeconds: 8,
  },
];
describe('Content projects lifecycle', () => {
  let service: ContentProjectService, p: ContentProject, busy: boolean;
  const output = jest.fn();
  beforeEach(() => {
    busy = false;
    output.mockReset();
    p = {
      id: randomUUID(),
      config,
      status: 'DRAFT',
      revision: 0,
      ideas: [],
      selectedIdea: null,
      script: null,
      scenes: [],
      scriptStale: false,
      scenesStale: false,
      usage: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const repo = {
      create: jest.fn((c: ContentProject['config']) =>
        Promise.resolve({ ...p, config: c }),
      ),
      get: jest.fn(() => Promise.resolve(structuredClone(p))),
      list: jest.fn(() => Promise.resolve({ items: [structuredClone(p)] })),
      locked: async <T>(
        _id: string,
        work: (project: ContentProject, client: PoolClient) => Promise<T>,
      ) => {
        if (busy) throw new ConflictException();
        busy = true;
        try {
          return await work(structuredClone(p), {} as PoolClient);
        } finally {
          busy = false;
        }
      },
      save: jest.fn((project: ContentProject) => {
        p = { ...structuredClone(project), revision: project.revision + 1 };
        return Promise.resolve(structuredClone(p));
      }),
    };
    const generator = new ContentProjectGenerationService(
      { generateStructuredOutput: output } as unknown as LlmProvider,
      { getModel: () => 'mock-model' } as unknown as AiAnalysisService,
    );
    service = new ContentProjectService(
      repo as unknown as ContentProjectRepository,
      generator,
    );
  });
  const request = () => ({ revision: p.revision, confirm: true });
  function respond(data: unknown) {
    output.mockResolvedValueOnce({
      data,
      provider: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
  }
  async function choose() {
    respond({ ideas: [idea, idea, idea] });
    await service.generate(p.id, 'ideas', request());
    await service.select(p.id, p.ideas[0].ideaId, request());
  }
  async function narrated() {
    await choose();
    respond(script);
    await service.generate(p.id, 'script', request());
  }
  async function staged() {
    await narrated();
    await service.approveScript(p.id, request());
    respond({ scenes });
    await service.generate(p.id, 'scenes', request());
  }
  it('creates persistent draft without a topic dependency', async () => {
    expect((await service.create({ topic: 'Manual' })).config.topic).toBe(
      'Manual',
    );
  });
  it('requires a nonempty topic and supports only implemented media', () => {
    expect(() => service.create({ topic: ' ' })).toThrow(BadRequestException);
    expect(() => service.create({ topic: 'Tema', type: 'REEL' })).toThrow(
      BadRequestException,
    );
  });
  it('generates 3 ideas and stores model and tokens', async () => {
    respond({ ideas: [idea, idea, idea] });
    await service.generate(p.id, 'ideas', request());
    expect(p.status).toBe('IDEAS_GENERATED');
    expect(p.ideas).toHaveLength(3);
    expect(p.usage[0]).toMatchObject({ model: 'mock-model', totalTokens: 30 });
  });
  it('selects only a project idea', async () => {
    await choose();
    expect(p.status).toBe('IDEA_SELECTED');
    await expect(service.select(p.id, randomUUID(), request())).rejects.toThrow(
      BadRequestException,
    );
  });
  it('blocks script before selecting', async () => {
    await expect(service.generate(p.id, 'script', request())).rejects.toThrow(
      ConflictException,
    );
    expect(output).not.toHaveBeenCalled();
  });
  it('generates and estimates narration', async () => {
    await narrated();
    expect(p.status).toBe('SCRIPT_GENERATED');
    expect(p.script?.estimatedDurationSeconds).toBe(15);
  });
  it('edits and approves script independently', async () => {
    await narrated();
    await service.saveScript(p.id, {
      ...request(),
      script: { ...script, title: 'Edição manual' },
    });
    expect(p.script?.title).toBe('Edição manual');
    await service.approveScript(p.id, request());
    expect(p.status).toBe('SCRIPT_APPROVED');
  });
  it('blocks scenes before script approval', async () => {
    await narrated();
    await expect(service.generate(p.id, 'scenes', request())).rejects.toThrow(
      ConflictException,
    );
  });
  it('generates, edits, approves and reopens scenes', async () => {
    await staged();
    const scene = p.scenes[0];
    await service.saveScene(p.id, scene.id, {
      ...request(),
      scene: { ...scene, visualDescription: 'Visual revisado' },
    });
    await service.approveScenes(p.id, request());
    expect((await service.get(p.id)).status).toBe('SCENES_APPROVED');
    expect((await service.get(p.id)).scenes[0].visualDescription).toBe(
      'Visual revisado',
    );
  });
  it('rejects scenes from other projects and invalid duration', async () => {
    await staged();
    await expect(
      service.saveScene(p.id, randomUUID(), {
        ...request(),
        scene: p.scenes[0],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(() =>
      service.saveScene(p.id, p.scenes[0].id, {
        ...request(),
        scene: { ...p.scenes[0], estimatedDurationSeconds: 0 },
      }),
    ).toThrow(BadRequestException);
  });
  it('requires explicit invalidation confirmation', async () => {
    await staged();
    await expect(
      service.select(p.id, p.ideas[1].ideaId, { revision: p.revision }),
    ).rejects.toThrow(ConflictException);
    expect(p.scriptStale).toBe(false);
  });
  it('changing idea retains previous artifacts but blocks their use', async () => {
    await staged();
    const before = p.script;
    await service.select(p.id, p.ideas[1].ideaId, request());
    expect(p.script).toEqual(before);
    expect(p.scriptStale).toBe(true);
    expect(p.scenesStale).toBe(true);
    await expect(service.approveScript(p.id, request())).rejects.toThrow(
      ConflictException,
    );
  });
  it('editing approved script makes scenes outdated without deleting', async () => {
    await staged();
    await service.saveScript(p.id, {
      ...request(),
      script: { ...script, conclusion: 'Nova conclusão documentada' },
    });
    expect(p.scenes).toHaveLength(1);
    expect(p.scenesStale).toBe(true);
    expect(p.status).toBe('SCRIPT_GENERATED');
    await expect(service.approveScenes(p.id, request())).rejects.toThrow(
      ConflictException,
    );
  });
  it('configuration invalidates prior ideas and retains work', async () => {
    await staged();
    await service.update(p.id, {
      ...request(),
      config: { ...config, topic: 'Outro tema' },
    });
    expect(p.status).toBe('DRAFT');
    expect(p.script).not.toBeNull();
    await expect(
      service.select(p.id, p.ideas[0].ideaId, request()),
    ).rejects.toThrow(ConflictException);
  });
  it('LLM failure preserves previous approved project and revision', async () => {
    await staged();
    const before = structuredClone(p);
    output.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.generate(p.id, 'script', request())).rejects.toThrow(
      'timeout',
    );
    expect(p).toEqual(before);
  });
  it('invalid structured output preserves previous content', async () => {
    await narrated();
    const before = structuredClone(p);
    respond({ invalid: true });
    await expect(service.generate(p.id, 'script', request())).rejects.toThrow(
      'inválido',
    );
    expect(p).toEqual(before);
  });
  it('blocks simultaneous generations and stale revisions', async () => {
    await choose();
    let release!: (value: unknown) => void;
    output.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = service.generate(p.id, 'script', request());
    await expect(service.generate(p.id, 'script', request())).rejects.toThrow(
      ConflictException,
    );
    release({
      data: script,
      provider: 'mock',
      model: 'mock',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await first;
    await expect(service.approveScript(p.id, { revision: 0 })).rejects.toThrow(
      ConflictException,
    );
  });
  it('rejects invalid transitions and pagination', async () => {
    await expect(service.approveScript(p.id, request())).rejects.toThrow(
      ConflictException,
    );
    await expect(service.approveScenes(p.id, request())).rejects.toThrow(
      ConflictException,
    );
    expect(() => service.list(1000, 0)).toThrow(BadRequestException);
  });
  it('duration config changes requested word budget by ten times', () => {
    const one = projectPrompt('script', {
      ...config,
      targetDurationSeconds: 60,
    });
    const ten = projectPrompt('script', {
      ...config,
      targetDurationSeconds: 600,
    });
    expect(one.userPrompt).toContain(`${NARRATION_WORDS_PER_MINUTE} palavras`);
    expect(ten.userPrompt).toContain(
      `${NARRATION_WORDS_PER_MINUTE * 10} palavras`,
    );
  });
  it('unchanged config does not invalidate approved work despite JSONB key order', async () => {
    await staged();
    p.config = Object.fromEntries(
      Object.entries(p.config).reverse(),
    ) as ContentProject['config'];
    await service.update(p.id, {
      revision: p.revision,
      config,
      confirm: false,
    });
    expect(p.status).toBe('SCENES_GENERATED');
    expect(p.scenesStale).toBe(false);
  });
});
