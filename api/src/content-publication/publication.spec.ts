jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  defaultPreparation,
  metadataIssues,
  normalizeList,
  tagLength,
  composedDescription,
  preparationSchema,
} from './publication.schema';
import { composeThumbnail } from './publication-thumbnail.service';
import { ContentAccessGuard } from './content-access';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import type { PostgresDatabaseService } from '../database/postgres-database.service';
describe('Publication metadata and thumbnail validation', () => {
  const valid = () => {
    const p = defaultPreparation(),
      id = randomUUID();
    p.titles = [
      {
        id,
        text: 'Uma história de ficção',
        source: 'MANUAL',
        createdAt: new Date().toISOString(),
      },
    ];
    p.selectedTitleId = id;
    p.description = 'Uma história fictícia de mistério.';
    return p;
  };
  test('draft starts empty and optional tags/chapters do not block complete metadata', () => {
    expect(defaultPreparation().status).toBe('DRAFT');
    expect(metadataIssues(valid(), 60)).toEqual([]);
  });
  test.each(['<script>', 'x'.repeat(101)])(
    'rejects invalid title %s',
    (text) => {
      const p = valid();
      p.titles[0].text = text;
      expect(preparationSchema.safeParse(p).success).toBe(false);
    },
  );
  test('normalizes duplicate tags and hashtags independently', () => {
    expect(normalizeList(['Terror', 'terror', 'Mistério'])).toEqual([
      'terror',
      'Mistério',
    ]);
    expect(
      normalizeList(['Terror', '#terror', 'história narrada'], true),
    ).toEqual(['#terror', '#histórianarrada']);
  });
  test('tag budget includes commas and quotes for spaces', () => {
    expect(tagLength(['história de terror', 'conto'])).toBe(18 + 2 + 1 + 5);
    const p = valid();
    p.tags = Array.from({ length: 10 }, () => 'a'.repeat(60));
    expect(metadataIssues(p)).toContain(
      'As tags excedem o limite de 500 caracteres, incluindo separadores e aspas.',
    );
  });
  test('description budget counts UTF-8 bytes including composed fields', () => {
    const p = valid();
    p.description = 'á'.repeat(2501);
    expect(metadataIssues(p).some((i) => i.includes('5000 bytes'))).toBe(true);
  });
  test('does not duplicate hashtags already present in description', () => {
    const p = valid();
    p.description = 'Uma ficção #Terror';
    p.hashtags = ['#Terror', '#Mistério'];
    expect(composedDescription(p)).toBe('Uma ficção #Terror\n\n#Mistério');
    p.description = 'Uma ficção #Terror.';
    expect(composedDescription(p)).toBe('Uma ficção #Terror.\n\n#Mistério');
  });
  test('validates actual duration including last chapter and render version', () => {
    const p = valid();
    p.renderJobId = randomUUID();
    p.chaptersRenderJobId = p.renderJobId;
    p.chaptersEnabled = true;
    p.chapters = [
      { startSeconds: 0, title: 'Início' },
      { startSeconds: 20, title: 'Meio' },
      { startSeconds: 40, title: 'Fim' },
    ];
    expect(metadataIssues(p, 60)).toEqual([]);
    expect(composedDescription(p)).toContain('00:20 Meio');
    expect(metadataIssues(p, 45).length).toBeGreaterThan(0);
    p.chapters[1].startSeconds = 0;
    expect(metadataIssues(p, 60).length).toBeGreaterThan(0);
  });
  test('old render chapters require explicit review after switching video', () => {
    const p = valid();
    p.chaptersEnabled = true;
    p.renderJobId = randomUUID();
    p.chaptersRenderJobId = randomUUID();
    expect(metadataIssues(p, 60)).toContain(
      'Revise os capítulos para a renderização selecionada.',
    );
  });
  test.each([Buffer.from('broken'), Buffer.alloc(0)])(
    'rejects invalid upload without creating a ready image',
    async (input) => {
      await expect(
        composeThumbnail(input, {
          enabled: false,
          text: '',
          position: 'BOTTOM',
          fontSize: 72,
          color: '#FFFFFF',
          outline: true,
        }),
      ).rejects.toThrow();
    },
  );
  test('creates real JPEG, exact aspect and safe typography independently from image AI', async () => {
    const input = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: '#203060' },
    })
      .png()
      .toBuffer();
    const overlay = {
      enabled: true,
      text: 'NÃO ATENDA! <&>',
      position: 'BOTTOM' as const,
      fontSize: 72,
      color: '#FFFFFF',
      outline: true,
    };
    const withText = await composeThumbnail(input, overlay),
      plain = await composeThumbnail(input, { ...overlay, enabled: false });
    const meta = await sharp(withText).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1280, height: 720 });
    expect(withText.length).toBeLessThan(2 * 1024 * 1024);
    expect(withText.equals(plain)).toBe(false);
  });
  test('rejects tiny and unsupported images', async () => {
    const input = await sharp({
      create: { width: 320, height: 180, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      composeThumbnail(input, {
        enabled: false,
        text: '',
        position: 'BOTTOM',
        fontSize: 72,
        color: '#FFFFFF',
        outline: true,
      }),
    ).rejects.toThrow('640');
  });
});
describe('Local studio authentication and ownership', () => {
  const key = 'test-local-key-with-more-than-32-characters';
  const make = (
    path: string,
    token?: string,
    owner: string | null = 'local-owner',
    configured = true,
  ) => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ owner_id: owner }] }),
    };
    const config = {
      get: (name: string) =>
        name === 'CONTENT_ACCESS_KEY'
          ? configured
            ? key
            : undefined
          : 'local-owner',
    };
    const req = {
      originalUrl: path,
      headers: token ? { authorization: 'Bearer ' + token } : {},
      params: { projectId: randomUUID() },
    };
    return {
      guard: new ContentAccessGuard(
        config as unknown as ConfigService,
        db as unknown as PostgresDatabaseService,
      ),
      context: {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext,
    };
  };
  test('publication fails closed before access configuration', async () => {
    const f = make('/content-projects/id/publication', undefined, null, false);
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      'Configure CONTENT_ACCESS_KEY',
    );
  });
  test('preserves old local flow when access key is not enabled', async () => {
    const f = make('/content-projects', undefined, null, false);
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
  test.each([undefined, 'invalid', 'é'.repeat(24)])(
    'rejects anonymous and wrong credentials safely',
    async (token) => {
      const f = make('/content-projects/id/publication', token);
      await expect(f.guard.canActivate(f.context)).rejects.toThrow('chave');
    },
  );
  test('valid identity cannot access another owner project', async () => {
    const f = make('/content-projects/id/renders', key, 'other-owner');
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      'outro proprietário',
    );
  });
  test('same local owner can access project assets and renders', async () => {
    const f = make('/content-projects/id/assets/file', key);
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
});
