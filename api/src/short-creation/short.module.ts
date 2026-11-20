import { AudioMixService } from '../content-audio/audio-mix.service';
import {
  ShortMusicValidator,
  ShortMusicRenderer,
  ShortSoundtrackService,
} from './short-music.service';
import { ShortEditingReferenceAnalysisService } from './short-reference-analysis.service';
import { ShortEditingEffectsService } from './short-editing-effects.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AiModule } from '../ai/ai.module';
import { ContentAssetsModule } from '../content-assets/content-assets.module';
import { MediaProcess } from '../video-render/media-process';
import { RemixVideoValidator } from '../video-remix/remix-video.validator';
import { RemixImportSettings } from '../video-remix/remix-import.settings';
import { RemixAnalysisSettings } from '../video-remix/remix-analysis.settings';
import { RemixAnalysisMedia } from '../video-remix/remix-analysis.media';
import { VideoSceneAnalysisService } from '../video-remix/video-scene-analysis.service';
import { RemixStorySettings } from '../video-remix/remix-story.settings';
import { RemixVoiceService } from '../video-remix/remix-voice.service';
import { ShortSettings } from './short.settings';
import { ShortService } from './short.service';
import { ShortMedia } from './short.media';
import { ShortWorker } from './short.worker';
import {
  ShortController,
  ShortUploadGuard,
  ShortMusicUploadInterceptor,
} from './short.controller';
export async function shortUploadOptions(config: ConfigService) {
  const settings = new ShortSettings(config);
  await mkdir(settings.tempDir, { recursive: true, mode: 0o700 });
  return {
    storage: diskStorage({
      destination: settings.tempDir,
      filename: (req, _file, callback) => {
        const name = 'upload-' + randomUUID();
        req.once('aborted', () => {
          void unlink(join(settings.tempDir, name)).catch(() => {});
        });
        callback(null, name);
      },
    }),
    limits: {
      files: 1,
      fileSize: settings.maxBytes,
      fields: 1,
      fieldSize: 20,
      // Busboy also counts the final multipart boundary. The file and
      // field limits still enforce one video and one rights declaration.
      parts: 3,
    },
  };
}
@Module({
  imports: [
    AiModule,
    ContentAssetsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: shortUploadOptions,
    }),
  ],
  controllers: [ShortController],
  providers: [
    ShortSettings,
    AudioMixService,
    ShortMusicValidator,
    ShortMusicRenderer,
    ShortSoundtrackService,
    ShortMusicUploadInterceptor,
    ShortService,
    ShortMedia,
    ShortWorker,
    ShortEditingReferenceAnalysisService,
    ShortEditingEffectsService,
    ShortUploadGuard,
    MediaProcess,
    RemixVideoValidator,
    {
      provide: RemixImportSettings,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const short = new ShortSettings(config);
        return new RemixImportSettings({
          get: (key: string) =>
            key === 'VIDEO_REMIX_UPLOAD_MAX_MB'
              ? short.maxBytes / 1024 ** 2
              : key === 'VIDEO_REMIX_UPLOAD_TEMP_DIR'
                ? short.tempDir
                : config.get(key),
        } as ConfigService);
      },
    },
    RemixAnalysisSettings,
    RemixAnalysisMedia,
    VideoSceneAnalysisService,
    RemixStorySettings,
    RemixVoiceService,
  ],
})
export class ShortModule {}
