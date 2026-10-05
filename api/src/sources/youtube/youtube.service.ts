import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrendItem } from '../interfaces/trend-item/trend-item.interface';
import { YouTubeNormalizerService } from './youtube-normalizer/youtube-normalizer.service';
import { YoutubeMetricsRepository } from './youtube-metrics.repository';
import { periodStart } from './youtube-period';
import { YouTubeVideo } from './interfaces/youtube-video.interface';

interface YoutubeCategory {
  id: string;
  snippet: {
    title: string;
  };
}

interface YoutubeVideosResponse {
  items?: YouTubeVideo[];
}

interface YoutubeCategoriesResponse {
  items?: YoutubeCategory[];
}

@Injectable()
export class YoutubeService {
  private readonly baseUrl = 'https://www.googleapis.com/youtube/v3';
  private readonly apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly normalizer: YouTubeNormalizerService,
    private readonly metrics: YoutubeMetricsRepository,
  ) {
    this.apiKey = this.configService.get<string>('YOUTUBE_V3_API_KEY') ?? '';

    if (!this.apiKey) {
      throw new Error('YOUTUBE_V3_API_KEY não está configurada');
    }
  }

  async getRanking(regionCode = 'BR', period = 'today') {
    periodStart(period);
    if (!/^[A-Z]{2}$/.test(regionCode))
      throw new BadRequestException('Região inválida');
    return this.metrics.ranking(regionCode, period);
  }

  async refreshKnownVideos(alreadyCaptured = new Set<string>()) {
    const ids = (await this.metrics.knownIds()).filter(
      (id) => !alreadyCaptured.has(id),
    );
    for (let offset = 0; offset < ids.length; offset += 50) {
      const params = new URLSearchParams({
        part: 'snippet,statistics',
        id: ids.slice(offset, offset + 50).join(','),
        key: this.apiKey,
      });
      const response = await fetch(`${this.baseUrl}/videos?${params}`);
      if (!response.ok)
        throw new BadGatewayException('Erro ao atualizar métricas do YouTube');
      const data = (await response.json()) as YoutubeVideosResponse;
      await this.metrics.capture(data.items ?? []);
    }
  }

  async getNormalizedPopularVideos(regionCode = 'BR'): Promise<TrendItem[]> {
    const videos = await this.getPopularVideos(regionCode);
    return this.normalizer.normalizeMany(videos);
  }

  async getPopularVideos(regionCode = 'BR'): Promise<YouTubeVideo[]> {
    const videoParams = new URLSearchParams({
      part: 'snippet,statistics',
      chart: 'mostPopular',
      regionCode,
      maxResults: '50',
      key: this.apiKey,
    });

    const categoryParams = new URLSearchParams({
      part: 'snippet',
      regionCode,
      key: this.apiKey,
    });

    try {
      const [videosResponse, categoriesResponse] = await Promise.all([
        fetch(`${this.baseUrl}/videos?${videoParams}`),
        fetch(`${this.baseUrl}/videoCategories?${categoryParams}`),
      ]);

      if (!videosResponse.ok) {
        throw new BadGatewayException('Erro ao buscar vídeos do YouTube');
      }

      if (!categoriesResponse.ok) {
        throw new BadGatewayException('Erro ao buscar categorias do YouTube');
      }

      const videosData = (await videosResponse.json()) as YoutubeVideosResponse;

      const categoriesData =
        (await categoriesResponse.json()) as YoutubeCategoriesResponse;

      const categoriesMap = Object.fromEntries(
        (categoriesData.items ?? []).map((category) => [
          category.id,
          category.snippet.title,
        ]),
      );

      const videos = (videosData.items ?? []).map((video) => ({
        ...video,
        numberView: this.formatNumberView(video.statistics?.viewCount ?? '0'),
        categoryTitle:
          (video.snippet.categoryId
            ? categoriesMap[video.snippet.categoryId]
            : undefined) ?? 'Categoria desconhecida',
      }));
      await this.metrics.capture(videos, regionCode);
      return videos;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Não foi possível consultar o YouTube',
      );
    }
  }

  private formatNumberView(value: string | number): string {
    const numericValue = Number(value);

    if (numericValue >= 1_000_000) {
      return `${(numericValue / 1_000_000).toFixed(1)}M`;
    }

    if (numericValue >= 1_000) {
      return `${(numericValue / 1_000).toFixed(1)}K`;
    }

    return numericValue.toString();
  }
}
