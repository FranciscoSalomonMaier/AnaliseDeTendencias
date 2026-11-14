import { z } from 'zod';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  HttpException,
  ServiceUnavailableException,
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

  /** Shared official API access for Video Remix discovery; never retrieves media. */
  async discoveryRequest(
    resource: 'search' | 'videos',
    parameters: Record<string, string>,
  ): Promise<unknown> {
    const params = new URLSearchParams({ ...parameters, key: this.apiKey });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${resource}?${params}`, {
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível comunicar com o YouTube. Tente novamente.',
      );
    }
    if (!response.ok) {
      const failure = z
        .object({
          error: z.object({
            errors: z.array(z.object({ reason: z.string() })).optional(),
          }),
        })
        .safeParse(await response.json().catch(() => null));
      if (
        failure.success &&
        failure.data.error.errors?.some((e) =>
          [
            'quotaExceeded',
            'dailyLimitExceeded',
            'dailyLimitExceededUnreg',
          ].includes(e.reason),
        )
      )
        throw new HttpException(
          'Quota da YouTube Data API esgotada. Consulte o Google Cloud e aguarde a renovação da quota.',
          429,
        );
      if (response.status === 400)
        throw new BadRequestException(
          'O YouTube recusou os filtros ou a página da pesquisa. Inicie uma nova pesquisa.',
        );
      if (response.status === 429)
        throw new HttpException(
          'Limite de requisições do YouTube atingido. Aguarde.',
          429,
        );
      if (response.status === 403)
        throw new HttpException(
          'O YouTube recusou a consulta. Verifique a quota e as permissões da chave no Google Cloud.',
          403,
        );
      if (response.status === 401)
        throw new ServiceUnavailableException(
          'A chave do YouTube foi rejeitada. Verifique a configuração do servidor.',
        );
      throw new BadGatewayException(
        'O YouTube não conseguiu concluir a consulta.',
      );
    }
    try {
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('large');
      return JSON.parse(text) as unknown;
    } catch {
      throw new BadGatewayException(
        'O YouTube retornou uma resposta inválida.',
      );
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
