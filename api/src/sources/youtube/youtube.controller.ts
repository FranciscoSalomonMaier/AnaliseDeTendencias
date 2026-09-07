import { Controller, Get, Query } from '@nestjs/common';
import { YoutubeService } from './youtube.service';

@Controller('youtube')
export class YoutubeController {
  constructor(
    private readonly youtubeService: YoutubeService,
  ) {}

  @Get('popular')
  getPopularVideos(
    @Query('regionCode') regionCode = 'BR',
  ) {
    return this.youtubeService.getPopularVideos(regionCode);
  }
}