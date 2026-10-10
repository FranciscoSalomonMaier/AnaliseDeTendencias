jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { Test, TestingModule } from '@nestjs/testing';
import { TrendsController } from './trends.controller';
import { TrendsService } from './trends.service';

describe('TrendsController', () => {
  let controller: TrendsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrendsController],
      providers: [{ provide: TrendsService, useValue: {} }],
    }).compile();

    controller = module.get<TrendsController>(TrendsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
