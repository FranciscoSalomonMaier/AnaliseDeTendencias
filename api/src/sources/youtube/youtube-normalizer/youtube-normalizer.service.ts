import { Injectable } from '@nestjs/common';
import { TrendItem } from 'src/sources/interfaces/trend-item/trend-item.interface';
import { TrendSourceAdapter } from 'src/sources/interfaces/trend-source-adapter/trend-source-adapter.interface';
import { YouTubeVideo } from 'src/sources/youtube/interfaces/youtube-video.interface';

@Injectable()
export class YouTubeNormalizerService implements TrendSourceAdapter<YouTubeVideo> {
  normalize(video: YouTubeVideo): TrendItem {
    return {
      externalId: video.id,
      source: 'youtube',

      title: video.snippet.title.trim(),
      description: video.snippet.description?.trim() ?? '',
      url: `https://www.youtube.com/watch?v=${video.id}`,
      author: video.snippet.channelTitle.trim(),

      publishedAt: new Date(video.snippet.publishedAt),
      collectedAt: new Date(),

      category: video.snippet.categoryId,
      tags: this.normalizeTags(video.snippet.tags),

      metrics: {
        views: this.toNumber(video.statistics?.viewCount),
        likes: this.toNumber(video.statistics?.likeCount),
        comments: this.toNumber(video.statistics?.commentCount),
      },

      raw: video,
    };
  }

  normalizeMany(videos: YouTubeVideo[]): TrendItem[] {
    return videos.map((video) => this.normalize(video));
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags) {
      return [];
    }

    return [
      ...new Set(
        tags
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      ),
    ];
  }

  private toNumber(value?: string): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsedValue = Number(value);

    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }
}