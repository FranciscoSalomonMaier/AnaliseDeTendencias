import {
  Body,
  NotFoundException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RemixAnalysisService } from './remix-analysis.service';
@Controller('video-remix/projects/:projectId/analysis')
export class RemixAnalysisController {
  constructor(private readonly service: RemixAnalysisService) {}
  @Post('estimate') estimate(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Body() b: unknown,
  ) {
    return this.service.estimate(p, b);
  }
  @Post() start(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Body() b: unknown,
  ) {
    return this.service.start(p, b);
  }
  @Get() list(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.list(p);
  }
  @Get(':id') results(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.results(p, id);
  }
  @Get(':id/scenes/:sceneId') async scene(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) scene: string,
  ) {
    const r = await this.service.results(p, id);
    const found = r.scenes.find((s) => s.id === scene);
    if (!found) throw new NotFoundException('Cena não encontrada.');
    return found;
  }
  @Post(':id/cancel') cancel(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(p, id);
  }
  @Post(':id/retry') retry(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.retry(p, id);
  }
  @Patch(':id/candidates/:candidate') select(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('candidate', ParseUUIDPipe) candidate: string,
    @Body() b: unknown,
  ) {
    return this.service.select(p, id, candidate, b);
  }
  @Get(':id/frames/:frame') async frame(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frame', ParseUUIDPipe) frame: string,
    @Res() res: Response,
  ) {
    const data = await this.service.frame(p, id, frame);
    res
      .set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(data);
  }
}
