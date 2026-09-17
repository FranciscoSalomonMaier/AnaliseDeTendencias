import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
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

  @Post('youtube/ai-analysis')
  generateYoutubeAiAnalysis(
    @Query('regionCode') regionCode?: string,
    @Query('force') force?: string,
  ) {
    const region = this.parseRegion(regionCode);
    if (force !== undefined && force !== 'true' && force !== 'false') {
      throw new BadRequestException('force deve ser true ou false');
    }
    return this.trendsService.generateYoutubeAiAnalysis(
      region,
      force === 'true',
    );
  }

  @Get('youtube/ai-analysis/latest')
  getLatestYoutubeAiAnalysis(@Query('regionCode') regionCode?: string) {
    return this.trendsService.getLatestYoutubeAiAnalysis(
      this.parseRegion(regionCode),
    );
  }

  private parseRegion(value?: string): string {
    const region = (value ?? 'BR').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(region)) {
      throw new BadRequestException('regionCode deve conter duas letras');
    }
    return region;
  }
}
