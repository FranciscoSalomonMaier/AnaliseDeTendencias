jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ContentProjectService } from '../content-projects/content-project.service';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { VIDEO_FORMATS } from './video-formats';
import { editingSchema } from './editing-settings';
import { RenderSettings } from './render-settings';
import { imageMotionFilter } from './ffmpeg.renderer';
import { exportAss } from '../content-subtitles/subtitle.formats';
import { defaultSubtitles } from '../content-subtitles/subtitle.schema';
import { SceneImagePromptBuilder } from '../content-assets/scene-image-prompt.builder';
import {
  ProjectConfigSchema,
  ContentProject,
} from '../content-projects/content-project.schema';
import { projectPrompt } from '../ai/content-generation/prompts/content-project.prompt';
import { textOverlaySchema } from '../content-publication/publication.schema';
import { composeThumbnail } from '../content-publication/publication-thumbnail.service';
import sharp from 'sharp';
import type { TimelineScene } from './render-job';

describe('Vertical output and backward compatibility', () => {
  test('central presets and legacy configuration', () => {
    expect(VIDEO_FORMATS['16:9']).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(VIDEO_FORMATS['9:16']).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 30,
    });
    const settings = new RenderSettings({
      get: () => undefined,
    } as unknown as ConfigService);
    expect(settings.config.width).toBe(1920);
    expect(editingSchema.parse({}).aspectRatio).toBeUndefined();
    expect(
      ProjectConfigSchema.parse({ topic: 'História' }).aspectRatio,
    ).toBeUndefined();
  });
  test.each([-0.01, 1.01, Infinity, NaN])(
    'rejects invalid focal position %s',
    (value) => {
      expect(
        editingSchema.safeParse({
          scenes: { [randomUUID()]: { focalX: value } },
        }).success,
      ).toBe(false);
    },
  );
  test('preserves different scene settings and caption areas per orientation', () => {
    const id = randomUUID();
    const s = editingSchema.parse({
      aspectRatio: '9:16',
      variants: {
        '16:9': { [id]: { fit: 'CONTAIN' } },
        '9:16': { [id]: { fit: 'COVER', focalX: 0.8, zoom: 1.4 } },
      },
      subtitleVariants: { '9:16': { preset: 'BOLD_SHORTS', safeBottom: 0.2 } },
    });
    expect(s.variants?.['9:16']?.[id].focalX).toBe(0.8);
    expect(s.variants?.['16:9']?.[id].fit).toBe('CONTAIN');
    expect(s.subtitleVariants?.['9:16']?.safeBottom).toBe(0.2);
    expect(editingSchema.safeParse({ aspectRatio: '1:1' }).success).toBe(false);
    expect(
      editingSchema.safeParse({ scenes: { [id]: { zoom: 3 } } }).success,
    ).toBe(false);
  });
  test.each([
    'STATIC',
    'SLOW_ZOOM_IN',
    'SLOW_ZOOM_OUT',
    'PAN_LEFT',
    'PAN_RIGHT',
    'PAN_UP',
    'PAN_DOWN',
  ] as const)('vertical motion %s uses actual output geometry', (motion) => {
    const c = new RenderSettings({
      get: () => undefined,
    } as unknown as ConfigService).config;
    const graph = imageMotionFilter(
      { frames: 60, motion, amplitude: 0.05, easing: true } as TimelineScene,
      { ...c, ...VIDEO_FORMATS['9:16'] },
    );
    expect(graph).toContain('s=1080x1920:fps=30');
    expect(graph).toContain('setsar=1');
  });
  test('vertical captions retain timestamps and fit within configurable safe area', () => {
    const snapshot = {
      settings: {
        ...defaultSubtitles(),
        enabled: true,
        preset: 'BOLD_SHORTS' as const,
        safeBottom: 0.2,
        horizontalMargin: 0.1,
      },
      versions: [],
      segments: [
        {
          id: randomUUID(),
          order: 1,
          sceneId: randomUUID(),
          text: 'Uma breve história',
          startSeconds: 1.25,
          endSeconds: 2.5,
        },
      ],
    };
    const ass = exportAss(snapshot, 1080, 1920);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('0:00:01.25,0:00:02.50');
    expect(ass).toContain('\\pos(540,1536)');
    expect(ass).toContain('Liberation Sans,48,'); // narrow dimension scales font, not portrait height
    expect(snapshot.segments[0].text).toBe('Uma breve história');
  });
  test('vertical image prompt and short storytelling are separate from duration', () => {
    const p = {
      config: ProjectConfigSchema.parse({
        topic: 'História',
        aspectRatio: '9:16',
        targetDurationSeconds: 30,
      }),
      scenes: [
        {
          id: randomUUID(),
          order: 1,
          narration: 'A casa',
          visualDescription: 'Casa antiga',
          imagePrompt: 'Casa antiga',
        },
      ],
    } as ContentProject;
    const image = new SceneImagePromptBuilder().build(p, p.scenes[0]);
    expect(image.aspectRatio).toBe('9:16');
    expect(image.prompt).toContain('Vertical composition');
    expect(projectPrompt('script', p.config).userPrompt).toContain(
      'gancho honesto',
    );
    expect(
      projectPrompt('script', { ...p.config, targetDurationSeconds: 300 })
        .userPrompt,
    ).not.toContain('Formato curto:');
  });
  test('vertical cover uses same compositor and keeps legacy horizontal size', async () => {
    const input = await sharp({
      create: { width: 900, height: 1600, channels: 3, background: '#345678' },
    })
      .png()
      .toBuffer();
    for (const aspectRatio of ['16:9', '9:16'] as const) {
      const output = await composeThumbnail(
        input,
        textOverlaySchema.parse({
          aspectRatio,
          enabled: true,
          text: 'O MISTÉRIO',
          fontSize: 60,
        }),
      );
      const m = await sharp(output).metadata();
      expect([m.width, m.height]).toEqual(
        aspectRatio === '9:16' ? [720, 1280] : [1280, 720],
      );
      expect(output.length).toBeLessThan(2 * 1024 * 1024);
    }
  });
});

describe('Explicit short adaptation', () => {
  test('provider failure preserves source and does not create an incomplete derived project', async () => {
    const source = {
      id: randomUUID(),
      revision: 3,
      config: ProjectConfigSchema.parse({ topic: 'Uma casa' }),
      selectedIdea: { title: 'A casa' },
      script: { title: 'Original' },
      scriptStale: false,
    };
    const original = JSON.stringify(source);
    const create = jest.fn();
    const repo = {
      locked: jest.fn((_id: string, work: (p: unknown) => Promise<unknown>) =>
        work(source),
      ),
      create,
    };
    const generate = jest
      .fn()
      .mockRejectedValue(new Error('Provider unavailable'));
    const service = new ContentProjectService(
      repo as never,
      { generate } as never,
    );
    await expect(
      service.createShort(source.id, {
        revision: 3,
        targetDurationSeconds: 60,
        confirm: true,
      }),
    ).rejects.toThrow('Provider unavailable');
    expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify(source)).toBe(original);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      (generate.mock.calls[0] as [string, ContentProject])[1].config,
    ).toMatchObject({
      aspectRatio: '9:16',
      sourceProjectId: source.id,
      targetDurationSeconds: 60,
    });
    await expect(
      service.createShort(source.id, {
        revision: 2,
        targetDurationSeconds: 60,
        confirm: true,
      }),
    ).rejects.toThrow('Projeto alterado');
    await expect(
      service.createShort(source.id, {
        revision: 3,
        targetDurationSeconds: 60,
        confirm: false,
      }),
    ).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
