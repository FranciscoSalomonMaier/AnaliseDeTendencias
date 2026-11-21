import type { audioParameterSchemas } from './audio/audio.schema';
import type { graphicsParameterSchemas } from './graphics/graphics.schema';
import type { z } from 'zod';
import type {
  ResourceUsage,
  ResourceScope,
  ResourceCategory,
} from './editing-resource.registry';
import type { resourceParameterSchemas } from './definitions/visual.resources';
type ExecutableParameterSchemas = typeof resourceParameterSchemas &
  typeof graphicsParameterSchemas &
  typeof audioParameterSchemas;
type ExecutableResourceId = keyof ExecutableParameterSchemas;
export type ValidatedResourceUsage = {
  [K in ExecutableResourceId]: Omit<
    ResourceUsage,
    'resourceId' | 'parameters'
  > & {
    resourceId: K;
    parameters: z.infer<ExecutableParameterSchemas[K]>;
  };
}[ExecutableResourceId];
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
  graphicsAvailable?: boolean;
  audioEncoders?: ReadonlySet<string>;
  audioDecoders?: ReadonlySet<string>;
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
