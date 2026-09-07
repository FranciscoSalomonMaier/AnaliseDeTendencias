import { Controller, Get } from '@nestjs/common';
import { RedditService } from './reddit.service';

@Controller('reddit')
export class RedditController {
  constructor(private readonly redditService: RedditService) {}

  @Get('popular')
  getPopularPosts(){
    return this.redditService.getPopularPosts();
  }
}
