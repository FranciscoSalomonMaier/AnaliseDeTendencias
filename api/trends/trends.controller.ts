import { Controller, Get, Query } from '@nestjs/common';
import { TrendsService } from './trends.service';

@Controller('trends')
export class TrendsController {
  constructor(private readonly trendsService: TrendsService) {}

  @Get('youtube')
  analyzeYoutube(@Query('regionCode') regionCode = 'BR') {
    return this.trendsService.analyzeYoutube(regionCode);
  }

  @Get('youtube/grouped')
  analyzeGroupedYoutube(@Query('regionCode') regionCode = 'BR') {
    return this.trendsService.analyzeGroupedYoutube(regionCode);
  }
}
