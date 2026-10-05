import { Controller, Get, Query } from '@nestjs/common';
import { YoutubeService } from './youtube.service';

@Controller('youtube')
export class YoutubeController {
  constructor(private readonly youtubeService: YoutubeService) {}

  @Get('popular')
  getPopularVideos(
    @Query('regionCode') regionCode = 'BR',
    @Query('period') period = 'today',
  ) {
    return this.youtubeService.getRanking(regionCode, period);
  }
}
