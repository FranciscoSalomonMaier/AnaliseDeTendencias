import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  Query,
  Headers,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { videoRange } from '../video-render/video-render.controller';
import { RemixReviewService } from './remix-review.service';
@Controller('video-remix/projects/:projectId/review')
export class RemixReviewController {
  constructor(private readonly service: RemixReviewService) {}
  @Get('renders') list(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.list(p);
  }
  @Get('presets') presets(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.presets(p);
  }
  @Get('renders/:id') detail(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(p, id);
  }
  @Get('renders/:id/compare') compare(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('projectId', ParseUUIDPipe) other: string,
    @Query('renderId', ParseUUIDPipe) render: string,
  ) {
    return this.service.compare(p, id, other, render);
  }
  @Patch('renders/:id/rating') rate(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.service.rate(p, id, b);
  }
  @Delete('renders/:id') remove(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeRender(p, id);
  }
  @Post('renders/:id/jobs') enqueue(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.service.enqueue(p, id, b);
  }
  @Get('jobs') jobs(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.jobs(p);
  }
  @Post('jobs/:id/cancel') cancel(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(p, id);
  }
  @Get('deliveries') deliveries(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.deliveries(p);
  }
  @Patch('deliveries/:id/metadata') metadata(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.service.metadata(p, id, b);
  }
  @Delete('deliveries/:id') removeDelivery(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeDelivery(p, id);
  }
  @Get('deliveries/:id/file') async file(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const f = await this.service.media(p, id),
      slice = videoRange(range, f.size);
    res.set({
      'Content-Type': 'video/mp4',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    });
    if (download === '1')
      res.set('Content-Disposition', `attachment; filename="${f.name}"`);
    if (slice === false) {
      res.set('Content-Range', `bytes */${f.size}`);
      res.status(416).end();
      return;
    }
    if (slice) {
      res.status(206);
      res.set('Content-Range', `bytes ${slice.start}-${slice.end}/${f.size}`);
      res.set('Content-Length', String(slice.end - slice.start + 1));
    } else res.set('Content-Length', String(f.size));
    const stream = f.open(slice?.start, slice?.end);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
