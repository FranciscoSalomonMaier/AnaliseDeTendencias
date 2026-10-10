import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContentProjectModule } from '../content-projects/content-project.module';
import { ContentAssetsController } from './content-assets.controller';
import { ContentAssetsService } from './content-assets.service';
import { ContentAssetRepository } from './content-asset.repository';
import { ImageProvider } from './image.provider';
import { OpenAiImageProvider } from './openai-image.provider';
import { StorageProvider } from './storage.provider';
import { LocalStorageProvider } from './local-storage.provider';
import { ImageSettings } from './image-settings';
import { ImageGenerationQueue } from './image-generation.queue';
import { SceneImagePromptBuilder } from './scene-image-prompt.builder';
import { ImageFileValidator } from './image-file.validator';
@Module({
  imports: [AiModule, ContentProjectModule],
  controllers: [ContentAssetsController],
  providers: [
    ContentAssetsService,
    ContentAssetRepository,
    ImageSettings,
    ImageGenerationQueue,
    SceneImagePromptBuilder,
    ImageFileValidator,
    { provide: ImageProvider, useClass: OpenAiImageProvider },
    { provide: StorageProvider, useClass: LocalStorageProvider },
  ],
})
export class ContentAssetsModule {}
