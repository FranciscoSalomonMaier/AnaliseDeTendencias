import { z } from 'zod';
export const SHORT_CLASSIFICATION_VERSION = 1 as const;
export interface ClassificationCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Functional support, not merely registration or metadata persistence. */
  readonly available: boolean;
}
const entrySchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    available: z.boolean(),
  })
  .strict();
export function defineClassificationCatalog<
  const T extends readonly ClassificationCatalogEntry[],
>(entries: T): T {
  z.array(entrySchema)
    .nonempty()
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      'Identificadores duplicados no catálogo.',
    )
    .parse(entries);
  for (const entry of entries) Object.freeze(entry);
  return Object.freeze(entries);
}
