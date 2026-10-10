import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ContentAssetsService } from './content-assets.service';
import type { ImageUpload } from './image-file.validator';
import { IMAGE_UPLOAD_MAX_BYTES } from './image-settings';

const upload = FileInterceptor('file', {
  limits: {
    fileSize: IMAGE_UPLOAD_MAX_BYTES,
    files: 1,
    fields: 3,
    fieldSize: 1024,
  },
});
@Controller('content-projects/:projectId')
export class ContentAssetsController {
  constructor(private readonly service: ContentAssetsService) {}
  @Get('assets') list(@Param('projectId', ParseUUIDPipe) id: string) {
    return this.service.list(id);
  }
  @Get('scenes/:sceneId/assets') sceneAssets(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    return this.service.listScene(id, sceneId);
  }
  @Post('scenes/:sceneId/images/generate')
  @HttpCode(202)
  generate(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, sceneId, body);
  }
  @Post('images/generate-missing')
  @HttpCode(202)
  missing(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, null, body);
  }
  @Post('scenes/:sceneId/images/upload')
  @UseInterceptors(upload)
  upload(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() body: unknown,
    @UploadedFile() file?: ImageUpload,
  ) {
    return this.service.upload(id, sceneId, body, file);
  }
  @Post('references/upload')
  @UseInterceptors(upload)
  reference(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UploadedFile() file?: ImageUpload,
  ) {
    return this.service.upload(id, null, body, file);
  }
  @Patch('scenes/:sceneId/assets/:assetId/select')
  select(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() body: unknown,
  ) {
    return this.service.select(id, sceneId, assetId, body);
  }
  @Get('assets/:assetId/file')
  async file(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
  ) {
    const file = await this.service.file(id, assetId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', 'inline');
    res.send(file.image);
  }
}
