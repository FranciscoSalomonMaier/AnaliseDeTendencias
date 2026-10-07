jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { TrendingTopicsController } from './trending-topics.controller';
import { TrendingTopicsService } from './trending-topics.service';
describe('TrendingTopicsController', () => {
  it('parses the limit, region and forwards period', async () => {
    const getTrending = jest.fn().mockReturnValue({ topics: [] });
    const controller = new TrendingTopicsController({
      getTrending,
    } as unknown as TrendingTopicsService);
    await controller.getTrending(' br ', '7d', '20');
    expect(getTrending).toHaveBeenCalledWith('BR', '7d', 20);
  });
});
