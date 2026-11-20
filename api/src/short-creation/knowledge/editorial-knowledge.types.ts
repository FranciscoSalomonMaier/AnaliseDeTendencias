import { z } from 'zod';
import {
  editorialKnowledgeProfileSchema,
  editorialGuidanceSchema,
  editorialContextSchema,
  editorialConflictSchema,
  knowledgeOriginSchema,
} from './editorial-knowledge.schema';
export type EditorialKnowledgeProfile = z.infer<
  typeof editorialKnowledgeProfileSchema
>;
export type EditorialGuidance = z.infer<typeof editorialGuidanceSchema>;
export type EditorialContext = z.infer<typeof editorialContextSchema>;
export type EditorialConflict = z.infer<typeof editorialConflictSchema>;
export type KnowledgeOrigin = z.infer<typeof knowledgeOriginSchema>;
export type KnowledgeAxis = KnowledgeOrigin['axis'];
