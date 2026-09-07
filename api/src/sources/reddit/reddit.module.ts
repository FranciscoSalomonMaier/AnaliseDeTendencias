import { Module } from '@nestjs/common';
import { RedditService } from './reddit.service';
import { RedditController } from './reddit.controller';

@Module({
  controllers: [RedditController],
  providers: [RedditService],
})
export class RedditModule {}
