import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { VideoRemixService } from './video-remix.service';
@Controller('video-remix')
export class VideoRemixController {
  constructor(private readonly service: VideoRemixService) {}
  @Get('local-assets') localAssets() {
    return this.service.localAssets();
  }
  @Post('projects') create(@Body() body: unknown) {
    return this.service.create(body);
  }
  @Get('projects') list(@Query() query: unknown) {
    return this.service.list(query);
  }
  @Get('projects/:projectId') get(
    @Param('projectId', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(id);
  }
  @Patch('projects/:projectId') update(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, body);
  }
  @Delete('projects/:projectId') remove(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.remove(id, body);
  }
  @Get('projects/:projectId/sources') sources(
    @Param('projectId', ParseUUIDPipe) id: string,
  ) {
    return this.service.listSources(id);
  }
  @Post('projects/:projectId/sources') addSource(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.addSource(id, body);
  }
  @Delete('projects/:projectId/sources/:sourceId') removeSource(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('sourceId', ParseUUIDPipe) source: string,
    @Body() body: unknown,
  ) {
    return this.service.removeSource(id, source, body);
  }
}
