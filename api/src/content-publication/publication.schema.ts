import { z } from 'zod';
export const targetSchema = z.enum([
  'YOUTUBE_VIDEO',
  'YOUTUBE_SHORTS',
  'INSTAGRAM_REELS',
]);
export type PublicationTarget = z.infer<typeof targetSchema>;
export const titleText = z
  .string()
  .trim()
  .max(100)
  .refine((v) => !/[<>]/u.test(v), 'Título não pode conter < ou >.');
export const chapterSchema = z
  .object({
    startSeconds: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(100),
  })
  .strict();
export const textOverlaySchema = z
  .object({
    aspectRatio: z.enum(['16:9', '9:16']).optional(),
    enabled: z.boolean().default(false),
    text: z.string().trim().max(60).default(''),
    position: z.enum(['TOP', 'CENTER', 'BOTTOM']).default('BOTTOM'),
    fontSize: z.number().int().min(36).max(100).default(72),
    color: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .default('#FFFFFF'),
    outline: z.boolean().default(true),
  })
  .strict();
export const preparationSchema = z
  .object({
    platform: z.literal('YOUTUBE').default('YOUTUBE'),
    renderJobId: z.string().uuid().nullable().default(null),
    selectedTitleId: z.string().uuid().nullable().default(null),
    selectedThumbnailId: z.string().uuid().nullable().default(null),
    titles: z
      .array(
        z.object({
          id: z.string().uuid(),
          text: titleText,
          source: z.enum(['MANUAL', 'AI']),
          createdAt: z.string(),
        }),
      )
      .max(200)
      .default([]),
    description: z.string().max(5000).default(''),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    hashtags: z.array(z.string().trim().min(1).max(100)).max(60).default([]),
    chaptersEnabled: z.boolean().default(false),
    chapters: z.array(chapterSchema).max(200).default([]),
    chaptersRenderJobId: z.string().uuid().nullable().default(null),
    metadataRenderJobId: z.string().uuid().nullable().default(null),
    contextRevision: z.number().int().nonnegative().nullable().default(null),
    language: z
      .string()
      .regex(/^[a-z]{2}(?:-[A-Za-z]{2})?$/)
      .default('pt-BR'),
    titleStyle: z
      .enum(['AUTO', 'MYSTERY', 'CURIOSITY', 'DIRECT', 'STORYTELLING', 'SEO'])
      .default('AUTO'),
    thumbnailStyle: z
      .enum(['CINEMATIC', 'MYSTERY', 'HORROR', 'DOCUMENTARY', 'MINIMALIST'])
      .default('CINEMATIC'),
    thumbnailText: textOverlaySchema.default(() => textOverlaySchema.parse({})),
    status: z.enum(['DRAFT', 'READY']).default('DRAFT'),
  })
  .strict();
export type Preparation = z.infer<typeof preparationSchema>;
export const defaultPreparation = (): Preparation =>
  preparationSchema.parse({});
export const normalizeList = (items: string[], hashtag = false) =>
  [
    ...new Map(
      items.map((v) => {
        const value = hashtag
          ? '#' + v.replace(/^#+/u, '').replace(/\s+/gu, '')
          : v.trim();
        return [value.toLocaleLowerCase('pt-BR'), value];
      }),
    ).values(),
  ].filter((v) => v && v !== '#');
export const tagLength = (items: string[]) =>
  items.reduce(
    (n, tag) => n + [...tag].length + (tag.includes(' ') ? 2 : 0),
    Math.max(0, items.length - 1),
  );
export function chapterTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  return (
    (hours ? `${String(hours).padStart(2, '0')}:` : '') +
    `${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  );
}
export function composedDescription(p: Preparation) {
  const blocks = [p.description.trim()];
  if (p.chaptersEnabled && p.chapters.length)
    blocks.push(
      p.chapters
        .map((c) => `${chapterTime(c.startSeconds)} ${c.title}`)
        .join('\n'),
    );
  const missing = p.hashtags.filter(
    (h) =>
      !new RegExp(
        `(^|[^\\p{L}\\p{N}_])${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}_])`,
        'iu',
      ).test(p.description),
  );
  if (missing.length) blocks.push(missing.join(' '));
  return blocks.filter(Boolean).join('\n\n');
}
export function metadataIssues(p: Preparation, duration?: number) {
  const issues: string[] = [];
  const title = p.titles.find((t) => t.id === p.selectedTitleId)?.text;
  if (!title?.trim()) issues.push('Selecione um título válido.');
  if (!p.description.trim()) issues.push('Preencha a descrição.');
  if (
    /[<>]/u.test(p.description) ||
    Buffer.byteLength(composedDescription(p), 'utf8') > 5000
  )
    issues.push('Descrição final deve ter até 5000 bytes e não conter < ou >.');
  if (tagLength(p.tags) > 500)
    issues.push(
      'As tags excedem o limite de 500 caracteres, incluindo separadores e aspas.',
    );
  if (p.hashtags.some((h) => !/^#[\p{L}\p{N}_]+$/u.test(h)))
    issues.push('Hashtags devem conter somente letras, números ou sublinhado.');
  if (p.chaptersEnabled) {
    if (p.chapters.length < 3 || p.chapters[0]?.startSeconds !== 0)
      issues.push(
        'Capítulos exigem início em 00:00 e pelo menos três entradas.',
      );
    if (p.chaptersRenderJobId !== p.renderJobId)
      issues.push('Revise os capítulos para a renderização selecionada.');
    if (
      !duration ||
      p.chapters.some(
        (c, i) =>
          (p.chapters[i + 1]?.startSeconds ?? duration) - c.startSeconds < 10,
      )
    )
      issues.push(
        'Capítulos devem estar em ordem e durar pelo menos 10 segundos, inclusive o último.',
      );
  }
  return issues;
}
