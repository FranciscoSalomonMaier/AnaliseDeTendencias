import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { SubtitleService } from './subtitle.service';
@Controller('content-projects/:projectId')
export class SubtitleController {
  constructor(private readonly service: SubtitleService) {}
  @Get('subtitles') list(@Param('projectId', ParseUUIDPipe) id: string) {
    return this.service.list(id);
  }
  @Post('scenes/:sceneId/subtitles/generate') @HttpCode(202) generate(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) scene: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, scene, body);
  }
  @Post('subtitles/generate-missing') @HttpCode(202) missing(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, null, body);
  }
  @Patch('subtitle-settings') settings(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.settings(id, body);
  }
  @Patch('scenes/:sceneId/subtitles/:versionId') edit(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) scene: string,
    @Param('versionId', ParseUUIDPipe) v: string,
    @Body() body: unknown,
  ) {
    return this.service.edit(id, scene, v, body);
  }
  @Post('scenes/:sceneId/subtitles/:versionId/select') @HttpCode(200) select(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) scene: string,
    @Param('versionId', ParseUUIDPipe) v: string,
    @Body() body: unknown,
  ) {
    return this.service.select(id, scene, v, body);
  }
  @Get('subtitles/export/srt') async srt(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const srt = await this.service.srt(id);
    res
      .set({
        'Content-Type': 'application/x-subrip; charset=utf-8',
        'Content-Disposition': 'attachment; filename="subtitles.srt"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(srt);
  }
}
