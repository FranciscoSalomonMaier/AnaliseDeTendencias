import { TrendSource } from 'src/sources/interfaces/trend-item/trend-item.interface';
import { AnalyzedTrendItem } from '../analyzed-trend-item/analyzed-trend-item.interface';
import { TopicClusterMetrics } from '../topic-cluster-metrics/topic-cluster-metrics.interface';

export interface TopicCluster {
  id: string;
  topic: string;
  keywords: string[];
  categories: string[];
  sources: TrendSource[];
  items: AnalyzedTrendItem[];
  metrics: TopicClusterMetrics;
  isRecurringTopic: boolean;
  relevanceScore: number;
}
