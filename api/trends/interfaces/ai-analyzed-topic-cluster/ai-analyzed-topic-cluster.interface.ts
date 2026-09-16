import { AiTrendAnalysis } from "src/ai/schemas/ai-trend-analysis.schema";
import { TopicCluster } from "../topic-cluster/topic-cluster.interface";

export interface AiAnalyzedTopicCluster {
    cluster: TopicCluster;
    aiAnalysis: AiTrendAnalysis;
}