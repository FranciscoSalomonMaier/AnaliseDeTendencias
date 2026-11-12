import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IntelligentEditingService } from './intelligent-editing.service';
@Controller('content-projects/:projectId/intelligent-editing')
export class IntelligentEditingController {
  constructor(private readonly service: IntelligentEditingService) {}
  @Post('analyze') @HttpCode(202) analyze(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.analyze(id, body);
  }
  @Get('plans') list(@Param('projectId', ParseUUIDPipe) id: string) {
    return this.service.list(id);
  }
  @Get('plans/:planId') get(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) plan: string,
  ) {
    return this.service.get(id, plan);
  }
  @Patch('plans/:planId') review(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) plan: string,
    @Body() body: unknown,
  ) {
    return this.service.review(id, plan, body);
  }
  @Post('plans/:planId/approve') approve(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) plan: string,
    @Body() body: unknown,
  ) {
    return this.service.review(id, plan, {
      ...(typeof body === 'object' && body ? body : {}),
      approveAll: true,
    });
  }
  @Post('plans/:planId/apply') apply(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) plan: string,
    @Body() body: unknown,
  ) {
    return this.service.apply(id, plan, body);
  }
  @Post('plans/:planId/restore') restore(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) plan: string,
    @Body() body: unknown,
  ) {
    return this.service.apply(id, plan, body, true);
  }
  @Post('plans/:planId/cancel') cancel(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) plan: string,
  ) {
    return this.service.cancel(id, plan);
  }
  @Post('plans/:planId/preview') @HttpCode(202) preview(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) plan: string,
  ) {
    return this.service.preview(id, plan);
  }
}
