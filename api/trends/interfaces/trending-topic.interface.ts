import { YoutubePeriod } from '../../src/sources/youtube/youtube-period';

export interface TopicVideoSummary {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail?: string;
  currentViews: string;
  baselineViews: string;
  viewsInPeriod: string;
  capturedAt: string;
  baselineCapturedAt: string;
  actualHistorySeconds: number;
  hasFullPeriodData: boolean;
}

export interface TrendingTopic {
  id: string;
  name: string;
  primaryTopic?: string | null;
  canonicalKey?: string | null;
  entities?: string[];
  confidence?: number | null;
  keywords: string[];
  videoCount: number;
  totalViews: string;
  viewsInPeriod: string;
  period: YoutubePeriod;
  hasFullPeriodData: boolean;
  actualHistorySeconds: number;
  maxHistorySeconds: number;
  capturedAt: string;
  topVideos: TopicVideoSummary[];
}
