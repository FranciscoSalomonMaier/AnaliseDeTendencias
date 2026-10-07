import { Controller, Get, Query } from '@nestjs/common';
import { TrendingTopicsService } from './trending-topics.service';

@Controller('trends/youtube')
export class TrendingTopicsController {
  constructor(private readonly topics: TrendingTopicsService) {}

  @Get('topics')
  getTrending(
    @Query('regionCode') regionCode = 'BR',
    @Query('period') period = 'today',
    @Query('limit') limit = '20',
  ) {
    return this.topics.getTrending(
      regionCode.trim().toUpperCase(),
      period,
      Number(limit),
    );
  }
}
