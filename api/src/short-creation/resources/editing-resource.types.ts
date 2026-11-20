import type { z } from 'zod';
import type {
  ResourceUsage,
  ResourceScope,
  ResourceCategory,
} from './editing-resource.registry';
import type {
  ImplementedResourceId,
  resourceParameterSchemas,
} from './definitions/visual.resources';
export type ValidatedResourceUsage = {
  [K in ImplementedResourceId]: Omit<
    ResourceUsage,
    'resourceId' | 'parameters'
  > & {
    resourceId: K;
    parameters: z.infer<(typeof resourceParameterSchemas)[K]>;
  };
}[ImplementedResourceId];
export interface ResourceDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  category: ResourceCategory;
  scopes: ResourceScope[];
  implemented: boolean;
  changesDuration: boolean;
  requiredFilters: string[];
  restrictions: string[];
  legacyImplementation?: string;
  parametersSchema: z.ZodType | null;
}
export interface ResourceCapability {
  id: string;
  version: number;
  registered: true;
  implemented: boolean;
  technicallyAvailable: boolean;
  executionVerified: boolean;
  available: boolean;
  reasons: string[];
}
export interface ResourceEnvironment {
  ffmpegVersion: string;
  ffprobeAvailable: boolean;
  filters: ReadonlySet<string>;
  encoders: ReadonlySet<string>;
  xfadeTransitions: ReadonlySet<string>;
}
export interface DurationImpact {
  inputSeconds: number;
  outputSeconds: number;
  deltaSeconds: number;
  overlapSeconds: number;
  minimumInputSeconds: number;
  roundingToleranceSeconds: number;
  audioRequirement: string;
}
