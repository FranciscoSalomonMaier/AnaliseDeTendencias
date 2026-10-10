import type { Response } from 'express';
import { videoRange } from '../video-render/video-render.controller';
import {
  Body,
  Controller,
  Get,
  Headers,
  Res,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AudioUpload } from '../content-narration/audio-file.validator';
import { ProjectAudioService } from './project-audio.service';
const upload = FileInterceptor('file', {
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 4, fieldSize: 4096 },
});
@Controller('content-projects/:projectId')
export class ProjectAudioController {
  constructor(private readonly service: ProjectAudioService) {}
  @Get('audio-settings') get(@Param('projectId', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
  @Get('audio-library/:assetId/file')
  async file(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
    @Headers('range') range?: string,
  ) {
    const file = await this.service.media(id, assetId),
      slice = videoRange(range, file.size);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=86400');
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
  @Patch('audio-settings') save(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.save(id, body);
  }
  @Post('music/upload') @UseInterceptors(upload) music(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UploadedFile() file?: AudioUpload,
  ) {
    return this.service.upload(id, 'BACKGROUND_MUSIC', body, file);
  }
  @Post('sound-effects/upload') @UseInterceptors(upload) effect(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UploadedFile() file?: AudioUpload,
  ) {
    return this.service.upload(id, 'SOUND_EFFECT', body, file);
  }
}
