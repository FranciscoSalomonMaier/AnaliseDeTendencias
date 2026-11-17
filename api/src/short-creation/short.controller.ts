import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Headers,
  Query,
  Res,
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response, Request } from 'express';
import { videoRange } from '../video-render/video-render.controller';
import type { RemixUpload } from '../video-remix/remix-import.settings';
import { ShortService } from './short.service';
@Injectable()
export class ShortUploadGuard implements CanActivate {
  constructor(readonly service: ShortService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const id = req.params.id;
    if (
      typeof id !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)
    )
      throw new BadRequestException('Projeto inválido.');
    const p = await this.service.project(id);
    if (
      p.step !== 2 ||
      !p.data.scriptApproved ||
      ['QUEUED', 'RUNNING'].includes(p.status)
    )
      throw new BadRequestException(
        'Abra a etapa de envio e aguarde operações pendentes.',
      );
    return true;
  }
}
@Controller('shorts')
export class ShortController {
  constructor(readonly service: ShortService) {}
  @Get('options') options() {
    return this.service.options();
  }
  @Get() list() {
    return this.service.list();
  }
  @Post() create(@Body() raw: unknown) {
    return this.service.create(raw);
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
  @Patch(':id') patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.service.patch(id, raw);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
  @Post(':id/jobs') enqueue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.service.enqueue(id, raw);
  }
  @Post(':id/files')
  @UseGuards(ShortUploadGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: RemixUpload | undefined,
    @Body('rights') rights: unknown,
  ) {
    return this.service.upload(id, file, rights);
  }
  @Delete(':id/files/:fileId') removeFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) file: string,
  ) {
    return this.service.removeFile(id, file);
  }
  @Get(':id/files/:fileId') source(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) file: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    return this.stream(id, 'source', range, res, file);
  }
  @Get(':id/audio') audio(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    return this.stream(id, 'audio', range, res);
  }
  @Get(':id/video') video(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('range') range: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    return this.stream(id, 'video', range, res, undefined, download === '1');
  }
  async stream(
    id: string,
    type: 'source' | 'audio' | 'video',
    range: string | undefined,
    res: Response,
    fileId?: string,
    download = false,
  ) {
    const f = await this.service.media(id, type, fileId);
    const slice = videoRange(range, f.bytes);
    res.set({
      'Content-Type': f.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (download)
      res.set('Content-Disposition', `attachment; filename="short-${id}.mp4"`);
    if (slice === false) {
      res.status(416).set('Content-Range', `bytes */${f.bytes}`).end();
      return;
    }
    if (slice) {
      res.status(206).set({
        'Content-Range': `bytes ${slice.start}-${slice.end}/${f.bytes}`,
        'Content-Length': String(slice.end - slice.start + 1),
      });
    } else res.set('Content-Length', String(f.bytes));
    const stream = slice ? f.open(slice.start, slice.end) : f.open();
    res.once('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
