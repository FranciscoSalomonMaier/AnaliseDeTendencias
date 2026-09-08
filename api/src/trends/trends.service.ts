import { Injectable } from '@nestjs/common';
import { TrendItem } from 'src/sources/interfaces/trend-item/trend-item.interface';
import { YouTubeNormalizerService } from 'src/sources/youtube/youtube-normalizer/youtube-normalizer.service';
import { YoutubeService } from 'src/sources/youtube/youtube.service';

@Injectable()
export class TrendsService {
    constructor(
        private readonly youtubeService: YoutubeService,
        private readonly youtubeNormalizer: YouTubeNormalizerService,
    ) {}

    async collectYouTubeTrends(): Promise<TrendItem[]> {
        const videos = await this.youtubeService.getPopularVideos('BR');

        return this.youtubeNormalizer.normalizeMany(videos);
    }
}
