import { z } from 'zod';
import { editingResourceRegistry } from '../resources/editing-resource.registry';
import { resourceUsageSchema } from '../resources/editing-resource.schema';
import {
  planningResponseSchema,
  type PlanningResponse,
} from './planning.schema';
/** Provider-facing strict alternatives derived from the central registry. No free-form
 * parameter record is sent to a structured-output provider. Domain checks still run. */
function operations(category: 'VISUAL' | 'GRAPHICS' | 'AUDIO', max: number) {
  const definitions = editingResourceRegistry.filter((d) =>
    category === 'GRAPHICS'
      ? d.category === 'TEXT_AND_GRAPHICS'
      : category === 'AUDIO'
        ? d.category === 'AUDIO'
        : !['AUDIO', 'TEXT_AND_GRAPHICS'].includes(d.category),
  );
  const alternatives = definitions.map((d) =>
    z
      .object({
        ...resourceUsageSchema.shape,
        resourceId: z.literal(d.id),
        resourceVersion: z.literal(d.version),
        parameters: d.parametersSchema!,
      })
      .strict(),
  );
  const usage = z.union(
    alternatives as [
      (typeof alternatives)[number],
      (typeof alternatives)[number],
      ...(typeof alternatives)[number][],
    ],
  );
  return z
    .array(
      z
        .object({
          ...planningResponseSchema.shape.visualOperations.element.shape,
          usage,
        })
        .strict(),
    )
    .max(max);
}
export const planningModelResponseSchema = z
  .object({
    ...planningResponseSchema.shape,
    visualOperations: operations('VISUAL', 12).min(1),
    graphicOperations: operations('GRAPHICS', 12),
    audioOperations: operations('AUDIO', 64),
  })
  .strict() as unknown as z.ZodType<PlanningResponse>;

/** Strict structured-output dialect: every field is required; absent optional/default
 * values travel as null. This adapter projection does not replace domain validation. */
function providerNode(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional)
    return providerNode(schema.unwrap() as z.ZodType).nullable();
  if (schema instanceof z.ZodDefault)
    return providerNode(schema.removeDefault() as z.ZodType).nullable();
  if (schema instanceof z.ZodNullable)
    return providerNode(schema.unwrap() as z.ZodType).nullable();
  if (schema instanceof z.ZodObject)
    return z
      .object(
        Object.fromEntries(
          Object.entries(schema.shape).map(([key, value]) => [
            key,
            providerNode(value as z.ZodType),
          ]),
        ),
      )
      .strict();
  if (schema instanceof z.ZodArray)
    return schema.clone({
      ...schema.def,
      element: providerNode(schema.element as z.ZodType),
    });
  if (schema instanceof z.ZodUnion)
    return z.union(
      schema.options.map((o) => providerNode(o as z.ZodType)) as [
        z.ZodType,
        z.ZodType,
        ...z.ZodType[],
      ],
    );
  return schema;
}
export const planningProviderResponseSchema = providerNode(
  planningModelResponseSchema,
);
/** Null represents omission only in the provider dialect; no domain field is nullable. */
export function normalizeProviderResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeProviderResponse);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, normalizeProviderResponse(v)]),
    );
  return value;
}
