import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Res,
  Headers,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { videoRange } from '../video-render/video-render.controller';
import { RemixAssemblyService } from './remix-assembly.service';
@Controller('video-remix/projects/:projectId/assembly')
export class RemixAssemblyController {
  constructor(private readonly service: RemixAssemblyService) {}
  @Get('timelines') list(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.list(p);
  }
  @Post('timelines') create(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Body() b: unknown,
  ) {
    return this.service.create(p, b);
  }
  @Get('timelines/:id') get(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(p, id);
  }
  @Patch('timelines/:id') update(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.service.update(p, id, b);
  }
  @Post('timelines/:id/render') render(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.service.request(p, id, b);
  }
  @Get('renders') renders(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.renders(p);
  }
  @Post('renders/:id/cancel') cancel(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(p, id);
  }
  @Get('renders/:id/file') async file(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('range') range: string | undefined,
    @Query('download') download: string | undefined,
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
      res.set('Content-Disposition', `attachment; filename="remix-${id}.mp4"`);
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
