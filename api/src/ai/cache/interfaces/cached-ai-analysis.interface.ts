import { AiAnalyzedTopicCluster } from 'trends/interfaces/ai-analyzed-topic-cluster/ai-analyzed-topic-cluster.interface';

export interface CachedAiAnalysis {
  key: string;
  regionCode: string;
  fingerprint: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  result: AiAnalyzedTopicCluster[];
}

export interface AiAnalysisResponse {
  data: AiAnalyzedTopicCluster[];
  meta: {
    regionCode: string;
    model: string;
    generatedAt: string;
    expiresAt: string;
    cached: boolean;
    fingerprint: string;
  };
}
