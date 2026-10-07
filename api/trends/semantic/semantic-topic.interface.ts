import type { TopicName } from './topic-naming.service';
import { YouTubeVideo } from '../../src/sources/youtube/interfaces/youtube-video.interface';
export interface SemanticVideo {
  video: YouTubeVideo;
  vector: number[];
  sourceHash: string;
  entities: string[];
  specificEntities?: string[];
}
export interface SemanticCluster {
  members: SemanticVideo[];
  centroid: number[];
}
export interface StoredTopic {
  id: string;
  region_code: string;
  model: string;
  name: string;
  classification_cache?: Record<
    string,
    TopicName & { retryAfter?: string | null }
  >;
  primary_topic?: string | null;
  canonical_key?: string | null;
  confidence?: number | null;
  keywords: string[];
  entities: string[];
  centroid: number[];
  naming_source: string;
  naming_hash: string;
  member_ids: string[];
  retry_after: Date | null;
}
