jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import { YoutubeService } from './youtube.service';
import { YouTubeNormalizerService } from './youtube-normalizer/youtube-normalizer.service';
import { YoutubeMetricsRepository } from './youtube-metrics.repository';

describe('YoutubeService period ranking', () => {
  const ranking = jest.fn().mockResolvedValue([]);
  const service = new YoutubeService(
    { get: () => 'test' } as unknown as ConfigService,
    {} as YouTubeNormalizerService,
    { ranking } as unknown as YoutubeMetricsRepository,
  );
  it('uses only the repository for period selection', async () => {
    await expect(service.getRanking('BR', '7d')).resolves.toEqual([]);
    expect(ranking).toHaveBeenCalledWith('BR', '7d');
  });
  it('rejects invalid periods', async () => {
    await expect(service.getRanking('BR', 'invalid')).rejects.toThrow();
  });
  it('rejects invalid regions', async () => {
    await expect(service.getRanking('bad', 'today')).rejects.toThrow();
  });
});
