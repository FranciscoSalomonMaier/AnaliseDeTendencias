import { z } from 'zod';
export const remixStatuses = [
  'DRAFT',
  'SOURCES_PENDING',
  'ANALYZING',
  'SCRIPTING',
  'RENDERING',
  'COMPLETED',
  'FAILED',
] as const;
export type RemixStatus = (typeof remixStatuses)[number];
export const remixTransitions: Record<RemixStatus, readonly RemixStatus[]> = {
  DRAFT: ['SOURCES_PENDING'],
  SOURCES_PENDING: ['DRAFT', 'ANALYZING', 'FAILED'],
  ANALYZING: ['SCRIPTING', 'FAILED'],
  SCRIPTING: ['RENDERING', 'FAILED'],
  RENDERING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['DRAFT'],
};
export const canTransition = (from: RemixStatus, to: RemixStatus) =>
  remixTransitions[from]?.includes(to) ?? false;
export const remixProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    topic: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).default(''),
    mode: z.enum(['SINGLE_SOURCE', 'MULTI_SOURCE']),
    narrationLanguage: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(35),
    targetDurationSeconds: z.number().finite().int().min(5).max(600),
    aspectRatio: z.enum(['16:9', '9:16']),
  })
  .strict();
export const remixUpdateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    data: remixProjectSchema
      .partial()
      .extend({ description: z.string().trim().max(4000).optional() })
      .refine((d) => Object.keys(d).length > 0),
  })
  .strict();
export const remixDeleteSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    confirm: z.literal(true),
  })
  .strict();
const https = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((v) => {
    try {
      const url = new URL(v);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use uma URL HTTPS sem credenciais.');
export const remixSourceSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200),
    originType: z.enum(['EXTERNAL_URL', 'LOCAL_ASSET']),
    originalUrl: https.optional(),
    localAssetId: z.string().uuid().optional(),
    durationSeconds: z.number().finite().positive().max(86400).optional(),
    licensing: z
      .object({
        authorization: z.enum([
          'UNKNOWN',
          'OWNED',
          'AUTHORIZED',
          'PUBLIC_DOMAIN',
        ]),
        notes: z.string().trim().max(2000).default(''),
        licenseUrl: https.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.originType === 'EXTERNAL_URL'
        ? !s.originalUrl || !!s.localAssetId
        : !s.localAssetId || !!s.originalUrl
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Informe apenas a URL ou o asset local correspondente ao tipo de origem.',
      });
  });
export interface RemixProject extends z.infer<typeof remixProjectSchema> {
  id: string;
  status: RemixStatus;
  revision: number;
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface RemixSource {
  id: string;
  projectId: string;
  title: string;
  originType: 'EXTERNAL_URL' | 'LOCAL_ASSET' | 'LOCAL_UPLOAD';
  originalUrl: string | null;
  localAssetId: string | null;
  durationSeconds: number | null;
  status:
    | 'METADATA_ONLY'
    | 'LOCAL_AVAILABLE'
    | 'UNAVAILABLE'
    | 'SELECTED'
    | 'IMPORTED';
  platform?: string | null;
  externalId?: string | null;
  platformMetadata?: Record<string, unknown>;
  importedFileId?: string | null;
  licensing: z.infer<typeof remixSourceSchema>['licensing'];
  createdAt: string;
}
