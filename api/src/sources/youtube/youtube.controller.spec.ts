jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { YoutubeController } from './youtube.controller';
import { YoutubeService } from './youtube.service';
describe('YoutubeController', () => {
  it('forwards region and period to existing endpoint', () => {
    const getRanking = jest.fn().mockReturnValue([]);
    const controller = new YoutubeController({
      getRanking,
    } as unknown as YoutubeService);
    expect(controller.getPopularVideos('BR', '30d')).toEqual([]);
    expect(getRanking).toHaveBeenCalledWith('BR', '30d');
  });
});
