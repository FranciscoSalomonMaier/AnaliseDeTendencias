import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ContentGenerationService } from './content-generation.service';

interface ContentPlanRequest {
  selectedIdea?: unknown;
}

interface SaveReviewedPlanRequest {
  script: unknown;
  videoPlan: unknown;
  approved: boolean;
}

interface SelectIdeaRequest {
  idea: unknown;
}

@Controller('trends')
export class ContentGenerationController {
  constructor(
    private readonly contentGenerationService: ContentGenerationService,
  ) {}

  @Post(':trendId/content/ideas')
  generateIdeas(
    @Param('trendId') trendId: string,
    @Query('regionCode') regionCode = 'BR',
    @Query('language') language = 'pt-BR',
    @Body() settings: unknown = {},
  ) {
    return this.contentGenerationService.generateIdeas(
      trendId,
      regionCode,
      language,
      settings,
    );
  }

  @Get('content/:generationId')
  getGeneration(@Param('generationId') generationId: string) {
    return this.contentGenerationService.getGeneration(generationId);
  }

  @Get('content')
  listGenerations(
    @Query('regionCode') regionCode?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.contentGenerationService.listGenerations(
      regionCode,
      limit === undefined ? 50 : Number(limit),
      offset === undefined ? 0 : Number(offset),
    );
  }

  @Patch('content/:generationId/selection')
  selectIdea(
    @Param('generationId') generationId: string,
    @Body() body: SelectIdeaRequest,
  ) {
    return this.contentGenerationService.selectIdea(generationId, body.idea);
  }

  @Patch('content/:generationId/script')
  saveReviewedScript(
    @Param('generationId') generationId: string,
    @Body() body: { script: unknown },
  ) {
    return this.contentGenerationService.saveReviewedScript(
      generationId,
      body.script,
    );
  }

  @Post('content/script')
  generateScript(@Body() idea: unknown) {
    return this.contentGenerationService.generateScript(idea);
  }

  @Post('content/scenes')
  generateScenes(@Body() script: unknown) {
    return this.contentGenerationService.generateScenes(script);
  }

  @Patch('content/:generationId/plan')
  saveReviewedPlan(
    @Param('generationId') generationId: string,
    @Body() body: SaveReviewedPlanRequest,
  ) {
    return this.contentGenerationService.saveReviewedPlan(
      generationId,
      body.script,
      body.videoPlan,
      body.approved,
    );
  }

  @Post(':trendId/content/plan')
  generateContentPlan(
    @Param('trendId') trendId: string,
    @Body() body: ContentPlanRequest = {},
    @Query('regionCode') regionCode = 'BR',
    @Query('language') language = 'pt-BR',
  ) {
    return this.contentGenerationService.generateContentPlan(
      trendId,
      body.selectedIdea,
      regionCode,
      language,
    );
  }
}
