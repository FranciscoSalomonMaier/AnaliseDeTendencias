jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { randomUUID } from 'node:crypto';
import { RemixScriptAiService } from './remix-script-ai.service';
import type { LlmProvider } from '../ai/llm.provider';
import type { StorageProvider } from '../content-assets/storage.provider';
import type { RemixStorySettings } from './remix-story.settings';
import type { Evidence, StoryDraft } from './remix-story.schema';

describe('script visual validation evidence', () => {
  function setup(count: number) {
    const frames = Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      timestamp: i + 1,
      key: `frame-${i}.jpg`,
    }));
    const ref = {
      id: randomUUID(),
      frames,
      licensing: {},
      confidence: 0.9,
      evidenceType: 'OBSERVED',
      scenes: [],
    } as unknown as Evidence;
    const generateStructuredOutput = jest.fn().mockResolvedValue({
      data: {
        status: 'SUPPORTED',
        reason: 'Detalhe visível no último frame.',
        suggestedRewrite: '',
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const read = jest.fn(async (key: string) => Buffer.from(key));
    const service = new RemixScriptAiService(
      { generateStructuredOutput } as unknown as LlmProvider,
      { read } as unknown as StorageProvider,
      { model: 'mock' } as RemixStorySettings,
    );
    const segment: StoryDraft = {
      kind: 'DEVELOPMENT',
      text: 'Um retrato aparece.',
      candidateIds: [ref.id],
      notes: '',
    };
    return { frames, ref, segment, service, read, generateStructuredOutput };
  }
  test('includes the third frame, matching evidence metadata to actual image order', async () => {
    const f = setup(3);
    const result = await f.service.validate(
      f.segment,
      [f.ref],
      new AbortController().signal,
    );
    const request = f.generateStructuredOutput.mock.calls[0][0];
    expect(f.read.mock.calls.map(([key]) => key)).toEqual(
      f.frames.map((frame) => frame.key),
    );
    expect(
      request.images.map((image: { dataUrl: string }) =>
        Buffer.from(image.dataUrl.split(',')[1], 'base64').toString(),
      ),
    ).toEqual(f.frames.map((frame) => frame.key));
    const prompt = JSON.parse(request.userPrompt);
    expect(prompt.imageOrder).toEqual(
      f.frames.map(({ id, timestamp }) => ({ id, timestamp })),
    );
    expect(prompt.evidence[0].frames).toEqual(prompt.imageOrder);
    expect(result.data.status).toBe('SUPPORTED');
  });
  test('keeps the six-frame bound and does not advertise omitted frames', async () => {
    const f = setup(8);
    await f.service.validate(f.segment, [f.ref], new AbortController().signal);
    const request = f.generateStructuredOutput.mock.calls[0][0];
    expect(request.images).toHaveLength(6);
    expect(JSON.parse(request.userPrompt).evidence[0].frames).toHaveLength(6);
    expect(f.read).not.toHaveBeenCalledWith('frame-6.jpg');
  });
  test('missing frames remain blocked without calling the model', async () => {
    const f = setup(0);
    const result = await f.service.validate(
      f.segment,
      [f.ref],
      new AbortController().signal,
    );
    expect(result.data.status).toBe('UNSUPPORTED');
    expect(f.generateStructuredOutput).not.toHaveBeenCalled();
  });
  test('additional images do not override inferred evidence protection', async () => {
    const f = setup(3);
    f.ref.evidenceType = 'INFERRED';
    const result = await f.service.validate(
      f.segment,
      [f.ref],
      new AbortController().signal,
    );
    expect(result.data.status).toBe('PARTIALLY_SUPPORTED');
  });
});
