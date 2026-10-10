import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ContentProjectService } from './content-project.service';
@Controller('content-projects')
export class ContentProjectController {
  constructor(private readonly service: ContentProjectService) {}
  @Post() create(@Body() body: unknown) {
    return this.service.create(body);
  }
  @Get() list(@Query('limit') limit = '50', @Query('offset') offset = '0') {
    return this.service.list(Number(limit), Number(offset));
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, body);
  }
  @Post(':id/ideas/generate') ideas(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, 'ideas', body);
  }
  @Post(':id/ideas/:ideaId/select') select(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ideaId', ParseUUIDPipe) ideaId: string,
    @Body() body: unknown,
  ) {
    return this.service.select(id, ideaId, body);
  }
  @Post(':id/script/generate') script(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, 'script', body);
  }
  @Patch(':id/script') saveScript(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveScript(id, body);
  }
  @Post(':id/script/approve') approveScript(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.approveScript(id, body);
  }
  @Post(':id/scenes/generate') scenes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(id, 'scenes', body);
  }
  @Patch(':id/scenes/:sceneId') saveScene(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() body: unknown,
  ) {
    return this.service.saveScene(id, sceneId, body);
  }
  @Post(':id/scenes/approve') approveScenes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.approveScenes(id, body);
  }
}
