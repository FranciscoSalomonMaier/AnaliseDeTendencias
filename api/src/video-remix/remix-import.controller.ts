import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  Req,
  Headers,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { videoRange } from '../video-render/video-render.controller';
import { RemixImportService } from './remix-import.service';
import { RemixFilesService } from './remix-files.service';
import { RemixUploadGuard } from './remix-upload.interceptor';
import { RemixImportSettings, type RemixUpload } from './remix-import.settings';
@Controller('video-remix/projects/:projectId')
export class RemixImportController {
  constructor(
    private readonly service: RemixImportService,
    private readonly files: RemixFilesService,
    private readonly settings: RemixImportSettings,
  ) {}
  @Get('import-settings') async settingsInfo(
    @Param('projectId', ParseUUIDPipe) id: string,
  ) {
    await this.service.authorize(id);
    return {
      maxBytes: this.settings.maxBytes,
      formats: ['mp4', 'mov', 'webm', 'mkv'],
      searchPageSize: 25,
    };
  }
  @Post('discovery/search') search(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.search(id, body);
  }
  @Get('discovery/videos/:videoId') details(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('videoId') video: string,
  ) {
    return this.service.details(id, video);
  }
  @Post('candidates') candidate(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.candidate(id, body);
  }
  @Get('candidates') async candidates(
    @Param('projectId', ParseUUIDPipe) id: string,
  ) {
    await this.service.authorize(id);
    return this.service.candidates(id);
  }
  @Post('files')
  @UseGuards(RemixUploadGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('projectId', ParseUUIDPipe) id: string,
    @UploadedFile() file: RemixUpload | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const closed = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', abort);
    res.once('close', closed);
    try {
      return await this.service.upload(id, file, body, controller.signal);
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', closed);
    }
  }
  @Get('files') async list(@Param('projectId', ParseUUIDPipe) id: string) {
    await this.service.authorize(id);
    return { items: await this.files.list(id) };
  }
  @Get('files/:fileId') async file(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) file: string,
  ) {
    await this.service.authorize(id);
    return this.files.info(id, file);
  }
  @Get('files/:fileId/file') async stream(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) file: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    await this.service.authorize(id);
    const f = await this.files.media(id, file);
    const slice = videoRange(range, f.size);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="remix-${file}.${f.extension}"`,
    );
    res.setHeader('Accept-Ranges', 'bytes');
    if (slice === false) {
      res.setHeader('Content-Range', `bytes */${f.size}`);
      res.status(416).end();
      return;
    }
    if (slice) {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${slice.start}-${slice.end}/${f.size}`,
      );
      res.setHeader('Content-Length', slice.end - slice.start + 1);
    } else res.setHeader('Content-Length', f.size);
    const stream = f.open(slice?.start, slice?.end);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  @Post('sources/:sourceId/file') attach(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sourceId', ParseUUIDPipe) source: string,
    @Body() body: unknown,
  ) {
    return this.service.attachFile(id, source, body);
  }
  @Delete('sources/:sourceId/file') unlink(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sourceId', ParseUUIDPipe) source: string,
    @Body() body: unknown,
  ) {
    return this.service.unlinkFile(id, source, body);
  }
  @Delete('files/:fileId') remove(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) file: string,
    @Body() body: unknown,
  ) {
    return this.service.deleteFile(id, file, body);
  }
  @Patch('sources/:sourceId/authorization') rights(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sourceId', ParseUUIDPipe) source: string,
    @Body() body: unknown,
  ) {
    return this.service.rights(id, source, body);
  }
}
