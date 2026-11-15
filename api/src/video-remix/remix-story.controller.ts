import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  Headers,
} from '@nestjs/common';
import type { Response } from 'express';
import { videoRange } from '../video-render/video-render.controller';
import { RemixStoryService } from './remix-story.service';
@Controller('video-remix/projects/:projectId/story')
export class RemixStoryController {
  constructor(private readonly service: RemixStoryService) {}
  @Get('options') options(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.options(p);
  }
  @Get('evidence') evidence(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.evidence(p);
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
  @Get('scripts') history(@Param('projectId', ParseUUIDPipe) p: string) {
    return this.service.history(p);
  }
  @Post('scripts') generate(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Body() b: unknown,
  ) {
    return this.service.enqueue(p, 'SCRIPT', b);
  }
  @Get('scripts/:id') get(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(p, id);
  }
  @Patch('scripts/:id') update(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.service.update(p, id, b);
  }
  @Post('scripts/:id/validate') validate(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.enqueue(p, 'VALIDATE', { ...b, scriptId: id });
  }
  @Post('scripts/:id/regenerate') regenerate(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.enqueue(p, 'REGENERATE', { ...b, scriptId: id });
  }
  @Post('scripts/:id/narrate') narrate(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.enqueue(p, 'NARRATE', { ...b, scriptId: id });
  }
  @Get('scripts/:id/synchronization') async sync(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const script = await this.service.get(p, id);
    return {
      scriptId: id,
      actualSeconds: script.actualSeconds,
      desiredSeconds: script.desiredSeconds,
      differenceSeconds: script.differenceSeconds,
      stale: script.stale,
      segments: script.segments.map((s) => ({
        id: s.id,
        references: s.references,
        narration: s.narration,
        ...s.sync,
      })),
    };
  }
  @Get('scripts/:id/audio/:audioId') async audio(
    @Param('projectId', ParseUUIDPipe) p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('audioId', ParseUUIDPipe) audio: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const f = await this.service.audio(p, id, audio),
      slice = videoRange(range, f.size);
    res.set({
      'Content-Type': f.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    });
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
