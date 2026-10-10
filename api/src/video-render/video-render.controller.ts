import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { VideoRenderService } from './video-render.service';
export function videoRange(
  range: string | undefined,
  size: number,
): { start: number; end: number } | null | false {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  let start = match[1] ? Number(match[1]) : 0,
    end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return false;
  return { start, end: Math.min(end, size - 1) };
}
@Controller('content-projects/:projectId')
export class VideoRenderController {
  constructor(private readonly service: VideoRenderService) {}
  @Get('timeline') timeline(@Param('projectId', ParseUUIDPipe) id: string) {
    return this.service.preview(id);
  }
  @Post('renders') @HttpCode(202) create(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.create(id, body);
  }
  @Get('renders') list(@Param('projectId', ParseUUIDPipe) id: string) {
    return this.service.list(id);
  }
  @Get('renders/:renderId') get(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('renderId', ParseUUIDPipe) jobId: string,
  ) {
    return this.service.get(id, jobId);
  }
  @Post('renders/:renderId/cancel') cancel(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('renderId', ParseUUIDPipe) jobId: string,
  ) {
    return this.service.cancel(id, jobId);
  }
  @Get('renders/:renderId/video') async video(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('renderId', ParseUUIDPipe) jobId: string,
    @Res() res: Response,
    @Headers('range') range?: string,
  ) {
    await this.stream(id, jobId, res, range, false);
  }
  @Get('renders/:renderId/download') async download(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('renderId', ParseUUIDPipe) jobId: string,
    @Res() res: Response,
    @Headers('range') range?: string,
  ) {
    await this.stream(id, jobId, res, range, true);
  }
  private async stream(
    id: string,
    jobId: string,
    res: Response,
    range: string | undefined,
    download: boolean,
  ) {
    const file = await this.service.media(id, jobId);
    const slice = videoRange(range, file.size);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="render-${jobId}.mp4"`,
    );
    if (slice === false) {
      res.setHeader('Content-Range', `bytes */${file.size}`);
      res.status(416).end();
      return;
    }
    if (slice) {
      res.setHeader(
        'Content-Range',
        `bytes ${slice.start}-${slice.end}/${file.size}`,
      );
      res.setHeader('Content-Length', slice.end - slice.start + 1);
      res.status(206);
    } else res.setHeader('Content-Length', file.size);
    const stream = file.open(slice?.start, slice?.end);
    stream.on('error', () => {
      if (res.headersSent) res.destroy();
      else res.status(404).end();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
