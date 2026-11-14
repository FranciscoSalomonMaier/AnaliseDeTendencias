import { z } from 'zod';
export const searchSchema = z
  .object({
    query: z.string().trim().min(2).max(200),
    maxResults: z.number().int().min(1).max(25).default(10),
    language: z
      .string()
      .regex(/^[a-z]{2,3}$/)
      .default('pt'),
    order: z.enum(['relevance', 'date', 'viewCount']).default('relevance'),
    duration: z.enum(['any', 'short', 'medium', 'long']).default('any'),
    creativeCommons: z.boolean().default(false),
    pageToken: z
      .string()
      .regex(/^[A-Za-z0-9_=-]+$/)
      .max(512)
      .optional(),
  })
  .strict();
export type DiscoverySearch = z.infer<typeof searchSchema>;
export interface DiscoveredVideo {
  externalId: string;
  platform: 'YOUTUBE';
  title: string;
  description: string;
  thumbnail: string | null;
  channel: string;
  channelId: string;
  originalUrl: string;
  publishedAt: string;
  durationSeconds: number | null;
  views: string | null;
  platformLicense: string | null;
  status: 'DISCOVERED';
  eligibility: 'REFERENCE_ONLY' | 'UNAVAILABLE';
  importNote: string;
}
export abstract class VideoDiscoveryProvider {
  abstract search(input: DiscoverySearch): Promise<{
    items: DiscoveredVideo[];
    nextPageToken: string | null;
    previousPageToken: string | null;
  }>;
  abstract getVideoDetails(id: string): Promise<DiscoveredVideo>;
  abstract getProviderName(): string;
}
export const rightsSchema = z
  .object({
    authorization: z.enum(['OWNED', 'AUTHORIZED', 'PUBLIC_DOMAIN']),
    userDeclaredRights: z.literal(true),
    author: z.string().trim().max(200).default(''),
    licenseType: z.string().trim().max(200).default(''),
    evidence: z.string().trim().min(1).max(2000),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict();
export const candidateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    externalId: z.string().regex(/^[\w-]{11}$/),
    replaceSourceId: z.string().uuid().optional(),
    confirmReplacement: z.boolean().optional(),
  })
  .strict();
export const attachSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    fileId: z.string().uuid(),
    rights: rightsSchema,
  })
  .strict();
