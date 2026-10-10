import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContentProjectController } from './content-project.controller';
import { ContentProjectRepository } from './content-project.repository';
import { ContentProjectService } from './content-project.service';
import { ContentProjectGenerationService } from './content-project-generation.service';
@Module({
  imports: [AiModule],
  controllers: [ContentProjectController],
  providers: [
    ContentProjectRepository,
    ContentProjectService,
    ContentProjectGenerationService,
  ],
  exports: [ContentProjectRepository],
})
export class ContentProjectModule {}
