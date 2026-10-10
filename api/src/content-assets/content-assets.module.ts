import { VideoRenderController } from '../video-render/video-render.controller';
import { VideoRenderService } from '../video-render/video-render.service';
import { RenderRepository } from '../video-render/render.repository';
import { TimelineBuilder } from '../video-render/timeline.builder';
import { RenderSettings } from '../video-render/render-settings';
import { MediaProcess } from '../video-render/media-process';
import { FfmpegRenderer } from '../video-render/ffmpeg.renderer';
import { ContentNarrationController } from '../content-narration/content-narration.controller';
import { ContentNarrationService } from '../content-narration/content-narration.service';
import { NarrationRepository } from '../content-narration/narration.repository';
import { TtsSettings } from '../content-narration/tts-settings';
import { AudioFileValidator } from '../content-narration/audio-file.validator';
import { OpenAiTtsProvider } from '../content-narration/openai-tts.provider';
import { TtsProvider } from '../content-narration/tts.provider';
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
  controllers: [
    ContentAssetsController,
    ContentNarrationController,
    VideoRenderController,
  ],
  providers: [
    VideoRenderService,
    RenderRepository,
    TimelineBuilder,
    RenderSettings,
    MediaProcess,
    FfmpegRenderer,
    ContentAssetsService,
    ContentNarrationService,
    NarrationRepository,
    TtsSettings,
    AudioFileValidator,
    { provide: TtsProvider, useClass: OpenAiTtsProvider },
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
