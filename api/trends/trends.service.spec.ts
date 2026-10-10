jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { Test, TestingModule } from '@nestjs/testing';
import { TrendsService } from './trends.service';

describe('TrendsService', () => {
  let service: TrendsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TrendsService],
    })
      .useMocker(() => ({ get: jest.fn(() => 'test-token') }))
      .compile();

    service = module.get<TrendsService>(TrendsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
