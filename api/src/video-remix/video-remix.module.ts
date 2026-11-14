import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { YoutubeModule } from '../sources/youtube/youtube.module';
import { MediaProcess } from '../video-render/media-process';
import { RemixImportSettings } from './remix-import.settings';
import { RemixImportController } from './remix-import.controller';
import { RemixImportService } from './remix-import.service';
import { RemixFilesService } from './remix-files.service';
import { RemixVideoValidator } from './remix-video.validator';
import { RemixUploadGuard } from './remix-upload.interceptor';
import { VideoDiscoveryProvider } from './discovery.schema';
import { YouTubeDiscoveryProvider } from './youtube-discovery.provider';
import { RemixDiscoveryService } from './remix-discovery.service';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContentAssetsModule } from '../content-assets/content-assets.module';
import { VideoRemixController } from './video-remix.controller';
import { VideoRemixRepository } from './video-remix.repository';
import { VideoRemixService } from './video-remix.service';
@Module({
  imports: [
    AiModule,
    ContentAssetsModule,
    YoutubeModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (c: ConfigService) => {
        const s = new RemixImportSettings(c);
        await mkdir(s.tempDir, { recursive: true, mode: 0o700 });
        return {
          storage: diskStorage({
            destination: s.tempDir,
            filename: (req, _file, callback) => {
              const name = 'remix-' + randomUUID();
              req.remixUploadPath = join(s.tempDir, name);
              req.once('aborted', () => {
                void unlink(req.remixUploadPath!).catch(() => {});
              });
              callback(null, name);
            },
          }),
          limits: {
            files: 1,
            fileSize: s.maxBytes,
            fields: 4,
            fieldSize: 10000,
            parts: 5,
          },
        };
      },
    }),
  ],
  controllers: [VideoRemixController, RemixImportController],
  providers: [
    VideoRemixRepository,
    VideoRemixService,
    RemixImportSettings,
    RemixImportService,
    RemixFilesService,
    RemixVideoValidator,
    RemixUploadGuard,
    MediaProcess,
    RemixDiscoveryService,
    { provide: VideoDiscoveryProvider, useClass: YouTubeDiscoveryProvider },
  ],
})
export class VideoRemixModule {}
