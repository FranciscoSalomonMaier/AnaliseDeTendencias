import { Test, TestingModule } from '@nestjs/testing';
import { YoutubeNormalizerService } from './youtube-normalizer.service';

describe('YoutubeNormalizerService', () => {
  let service: YoutubeNormalizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [YoutubeNormalizerService],
    }).compile();

    service = module.get<YoutubeNormalizerService>(YoutubeNormalizerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
