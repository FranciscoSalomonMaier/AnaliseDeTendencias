import { BadRequestException } from '@nestjs/common';
import { TrendsController } from './trends.controller';
import { TrendsService } from './trends.service';

jest.mock('./trends.service', () => ({ TrendsService: class {} }));

describe('TrendsController AI routes', () => {
  const service = {
    getLatestYoutubeAiAnalysis: jest.fn(),
    generateYoutubeAiAnalysis: jest.fn(),
  };
  const controller = new TrendsController(service as unknown as TrendsService);

  beforeEach(() => jest.clearAllMocks());

  it('normalizes the latest region and never invokes generation', () => {
    void controller.getLatestYoutubeAiAnalysis(' br ');
    expect(service.getLatestYoutubeAiAnalysis).toHaveBeenCalledWith('BR');
    expect(service.generateYoutubeAiAnalysis).not.toHaveBeenCalled();
  });

  it('accepts only exact true or false for force', () => {
    void controller.generateYoutubeAiAnalysis('us', 'true');
    expect(service.generateYoutubeAiAnalysis).toHaveBeenCalledWith('US', true);
    void controller.generateYoutubeAiAnalysis(undefined, 'false');
    expect(service.generateYoutubeAiAnalysis).toHaveBeenCalledWith('BR', false);
    expect(() => controller.generateYoutubeAiAnalysis('BR', 'yes')).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid regions', () => {
    expect(() => controller.getLatestYoutubeAiAnalysis('Brazil')).toThrow(
      BadRequestException,
    );
    expect(service.getLatestYoutubeAiAnalysis).not.toHaveBeenCalled();
  });
});
