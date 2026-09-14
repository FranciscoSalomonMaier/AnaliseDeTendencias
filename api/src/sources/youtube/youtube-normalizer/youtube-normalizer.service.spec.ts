import { Test, TestingModule } from '@nestjs/testing';
import { YouTubeNormalizerService } from './youtube-normalizer.service';

describe('YouTubeNormalizerService', () => {
  let service: YouTubeNormalizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [YouTubeNormalizerService],
    }).compile();

    service = module.get<YouTubeNormalizerService>(YouTubeNormalizerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
