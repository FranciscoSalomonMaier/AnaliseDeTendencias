import {
  Body,
  Query,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { PublicationService } from './publication.service';
import { PublicationThumbnailService } from './publication-thumbnail.service';
import { targetSchema, textOverlaySchema } from './publication.schema';
const revisionSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
@Controller('content-projects/:projectId/publication')
export class PublicationController {
  constructor(
    private readonly service: PublicationService,
    private readonly thumbs: PublicationThumbnailService,
  ) {}
  private target(value?: string) {
    const parsed = targetSchema.safeParse(value ?? 'YOUTUBE_VIDEO');
    if (!parsed.success)
      throw new BadRequestException('Destino de publicação inválido.');
    return parsed.data;
  }
  @Get() get(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Query('target') target?: string,
  ) {
    return this.service.get(id, this.target(target));
  }
  @Patch() save(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Query('target') target?: string,
  ) {
    return this.service.save(id, body, this.target(target));
  }
  @Post('generate') generate(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Query('target') target?: string,
  ) {
    return this.service.generate(id, body, this.target(target));
  }
  @Post('chapters') chapters(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Query('target') target?: string,
  ) {
    const parsed = revisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Revisão inválida.');
    return this.service.chapters(id, parsed.data.revision, this.target(target));
  }
  @Post('validate') async validate(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Query('target') target?: string,
  ) {
    return (await this.service.get(id, this.target(target))).checklist;
  }
  @Post('thumbnails/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 4096,
      },
    }),
  )
  async upload(
    @Param('projectId', ParseUUIDPipe) id: string,
    @UploadedFile() file?: { buffer: Buffer },
    @Body() body?: { overlay?: string },
  ) {
    await this.service.get(id);
    if (!file) throw new BadRequestException('Envie uma imagem JPEG ou PNG.');
    let overlay: unknown = {};
    try {
      overlay = body?.overlay ? JSON.parse(body.overlay) : {};
    } catch {
      throw new BadRequestException('Configuração de texto inválida.');
    }
    const parsed = textOverlaySchema.safeParse(overlay);
    if (!parsed.success)
      throw new BadRequestException('Configuração de texto inválida.');
    return this.thumbs.create(id, file.buffer, parsed.data, {
      source: 'USER_UPLOAD',
    });
  }
  @Post('thumbnails/:thumbnailId/compose') compose(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('thumbnailId', ParseUUIDPipe) thumbId: string,
    @Body() body: unknown,
  ) {
    const parsed = textOverlaySchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Configuração de texto inválida.');
    return this.thumbs.recompose(id, thumbId, parsed.data);
  }
  @Get('thumbnails/:thumbnailId/file') async file(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('thumbnailId', ParseUUIDPipe) thumbId: string,
    @Res() res: Response,
  ) {
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(await this.thumbs.file(id, thumbId));
  }
  @Get('thumbnails/:thumbnailId/download') async download(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('thumbnailId', ParseUUIDPipe) thumbId: string,
    @Res() res: Response,
  ) {
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="thumbnail-${id}.jpg"`,
    });
    res.send(await this.thumbs.file(id, thumbId));
  }
}
