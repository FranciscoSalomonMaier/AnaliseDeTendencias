import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RedditPost {
  kind: string;
  data: {
    id: string;
    name: string;
    title: string;
    author: string;
    subreddit: string;
    score: number;
    num_comments: number;
    url: string;
    permalink: string;
    created_utc: number;
  };
}

interface RedditPostsResponse {
  kind: string;
  data: {
    after: string | null;
    before: string | null;
    children: RedditPost[];
  };
}

@Injectable()
export class RedditService {
  private readonly baseUrl = 'https://oauth.reddit.com';
  private readonly accessToken: string;
  private readonly userAgent: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken =
      this.configService.get<string>('REDDIT_ACCESS_TOKEN') ?? '';

    this.userAgent =
      this.configService.get<string>('REDDIT_USER_AGENT') ??
      'trend-analysis/1.0 by Francisco';

    if (!this.accessToken) {
      throw new Error('REDDIT_ACCESS_TOKEN não está configurado');
    }
  }

  async getPopularPosts(): Promise<RedditPost['data'][]> {
    const params = new URLSearchParams({
      limit: '100',
      raw_json: '1',
    });

    try {
      const response = await fetch(
        `${this.baseUrl}/r/popular/rising?${params}`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'User-Agent': this.userAgent,
          },
        },
      );

      if (!response.ok) {
        throw new BadGatewayException(
          `Erro ao buscar postagens do Reddit: ${response.status}`,
        );
      }

      const result = (await response.json()) as RedditPostsResponse;

      return result.data.children.map((post) => post.data);
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Não foi possível consultar o Reddit',
      );
    }
  }
}