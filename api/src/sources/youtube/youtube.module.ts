import { Module } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import { YoutubeController } from './youtube.controller';
import { YouTubeNormalizerService } from './youtube-normalizer/youtube-normalizer.service';

@Module({
  providers: [YoutubeService, YouTubeNormalizerService],
  controllers: [YoutubeController],
  exports: [YoutubeService, YouTubeNormalizerService],
})
export class YoutubeModule {}
