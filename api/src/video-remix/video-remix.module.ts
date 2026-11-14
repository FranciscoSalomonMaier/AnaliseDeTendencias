import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContentAssetsModule } from '../content-assets/content-assets.module';
import { VideoRemixController } from './video-remix.controller';
import { VideoRemixRepository } from './video-remix.repository';
import { VideoRemixService } from './video-remix.service';
@Module({
  imports: [AiModule, ContentAssetsModule],
  controllers: [VideoRemixController],
  providers: [VideoRemixRepository, VideoRemixService],
})
export class VideoRemixModule {}
