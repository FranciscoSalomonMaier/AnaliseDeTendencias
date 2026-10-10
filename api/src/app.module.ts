import { ContentProjectModule } from './content-projects/content-project.module';
import { ContentAssetsModule } from './content-assets/content-assets.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { YoutubeModule } from './sources/youtube/youtube.module';
import { RedditModule } from './sources/reddit/reddit.module';
import { TrendsModule } from 'trends/trends.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    YoutubeModule,
    RedditModule,
    TrendsModule,
    ContentProjectModule,
    ContentAssetsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
