import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContentNarrationService } from './content-narration.service';
import type { AudioUpload } from './audio-file.validator';
@Controller('content-projects/:projectId')
export class ContentNarrationController {
  constructor(private readonly service: ContentNarrationService) {}
  @Get('audio/progress') progress(
    @Param('projectId', ParseUUIDPipe) id: string,
  ) {
    return this.service.list(id);
  }
  @Get('scenes/:sceneId/audio') list(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    return this.service.list(id, sceneId);
  }
  @Patch('narration-settings') settings(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveSettings(id, body);
  }
  @Post('scenes/:sceneId/audio/generate')
  @HttpCode(202)
  generate(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, sceneId, body);
  }
  @Post('audio/generate-missing')
  @HttpCode(202)
  missing(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, null, body);
  }
  @Post('audio/sample')
  @HttpCode(202)
  sample(@Param('projectId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.generate(id, null, body, true);
  }
  @Post('scenes/:sceneId/audio/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 1024,
      },
    }),
  )
  upload(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() body: unknown,
    @UploadedFile() file?: AudioUpload,
  ) {
    return this.service.upload(id, sceneId, body, file);
  }
  @Patch('scenes/:sceneId/audio/:assetId/select')
  select(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() body: unknown,
  ) {
    return this.service.select(id, sceneId, assetId, body);
  }
}
