import { z } from 'zod';

export const ContentOpportunitySchema = z.object({
  format: z.enum([
    'short_video',
    'long_video',
    'reel',
    'article',
    'carousel',
    'podcast',
  ]),
  title: z.string(),
  angle: z.string(),
  targetAudience: z.string(),
  rationale: z.string(),
});

export const AiTrendAnalysisSchema = z.object({
  clusterId: z.string(),
  refinedTopic: z.string(),
  summary: z.string(),

  trendStage: z.enum([
    'emerging',
    'growing',
    'stable',
    'declining',
    'unknown',
  ]),

  confidence: z.enum([
    'low',
    'medium',
    'high',
  ]),

  confidenceScore: z.number().min(0).max(100),

  relevanceExplanation: z.string(),

  evidence: z.array(z.string()).max(6),
  audienceInterests: z.array(z.string()).max(8),
  relatedTerms: z.array(z.string()).max(10),

  contentOpportunities: z
    .array(ContentOpportunitySchema)
    .max(5),

  limitations: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5),
});

export const AiAnalysisResultSchema = z.object({
  analyses: z.array(AiTrendAnalysisSchema),
});

export type AiTrendAnalysis = z.infer<
  typeof AiTrendAnalysisSchema
>;

export type AiAnalysisResult = z.infer<
  typeof AiAnalysisResultSchema
>;