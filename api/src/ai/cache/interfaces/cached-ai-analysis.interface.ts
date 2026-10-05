import { AiAnalyzedTopicCluster } from 'trends/interfaces/ai-analyzed-topic-cluster/ai-analyzed-topic-cluster.interface';
import { LlmUsage } from 'src/ai/llm.provider';

export interface CachedAiAnalysis {
  key: string;
  regionCode: string;
  fingerprint: string;
  model: string;
  provider: string;
  usage: LlmUsage;
  generatedAt: string;
  expiresAt: string;
  result: AiAnalyzedTopicCluster[];
}

export interface AiAnalysisResponse {
  data: AiAnalyzedTopicCluster[];
  meta: {
    regionCode: string;
    model: string;
    provider: string;
    usage: LlmUsage;
    generatedAt: string;
    expiresAt: string;
    cached: boolean;
    fingerprint: string;
  };
}
