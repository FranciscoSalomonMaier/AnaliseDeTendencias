import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { YoutubeService } from '../sources/youtube/youtube.service';
import {
  VideoDiscoveryProvider,
  type DiscoverySearch,
  type DiscoveredVideo,
} from './discovery.schema';
const snippet = z.object({
  title: z.string().max(1000),
  description: z.string().max(10000).default(''),
  channelTitle: z.string().max(300).default(''),
  channelId: z.string().max(100).default(''),
  publishedAt: z.string(),
  thumbnails: z.record(z.string(), z.object({ url: z.string() })).optional(),
});
const videoSchema = z.object({
  id: z.string().regex(/^[\w-]{11}$/),
  snippet,
  contentDetails: z.object({ duration: z.string() }).optional(),
  statistics: z
    .object({ viewCount: z.string().regex(/^\d+$/).optional() })
    .optional(),
  status: z
    .object({
      license: z.string().optional(),
      privacyStatus: z.string().optional(),
      uploadStatus: z.string().optional(),
    })
    .optional(),
});
export function isoDuration(value: string) {
  const m =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!m) return null;
  const duration =
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0);
  return duration > 0 && Number.isFinite(duration) ? duration : null;
}
@Injectable()
export class YouTubeDiscoveryProvider extends VideoDiscoveryProvider {
  constructor(private readonly youtube: YoutubeService) {
    super();
  }
  getProviderName() {
    return 'YOUTUBE';
  }
  private map(v: z.infer<typeof videoSchema>): DiscoveredVideo {
    const thumbs = v.snippet.thumbnails;
    const raw = thumbs?.medium?.url ?? thumbs?.default?.url;
    let thumbnail: string | null = null;
    try {
      if (raw) {
        const u = new URL(raw);
        if (u.protocol === 'https:' && u.hostname === 'i.ytimg.com')
          thumbnail = u.toString();
      }
    } catch {
      /* omit invalid platform image */
    }
    const available =
      v.status?.privacyStatus !== 'private' &&
      !['deleted', 'failed', 'rejected'].includes(v.status?.uploadStatus ?? '');
    return {
      externalId: v.id,
      platform: 'YOUTUBE',
      title: v.snippet.title,
      description: v.snippet.description,
      thumbnail,
      channel: v.snippet.channelTitle,
      channelId: v.snippet.channelId,
      originalUrl: `https://www.youtube.com/watch?v=${v.id}`,
      publishedAt: v.snippet.publishedAt,
      durationSeconds: isoDuration(v.contentDetails?.duration ?? ''),
      views: v.statistics?.viewCount ?? null,
      platformLicense: v.status?.license ?? null,
      status: 'DISCOVERED',
      eligibility: available ? 'REFERENCE_ONLY' : 'UNAVAILABLE',
      importNote: available
        ? 'Pode ser candidato. Exige arquivo obtido legitimamente e declaração de direitos para importar.'
        : 'Vídeo indisponível na plataforma.',
    };
  }
  async search(input: DiscoverySearch) {
    const data = z
      .object({
        items: z
          .array(
            z.object({
              id: z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }),
              snippet,
            }),
          )
          .max(50),
        nextPageToken: z.string().optional(),
        prevPageToken: z.string().optional(),
      })
      .safeParse(
        await this.youtube.discoveryRequest('search', {
          part: 'snippet',
          type: 'video',
          q: input.query,
          maxResults: String(input.maxResults),
          relevanceLanguage: input.language,
          order: input.order,
          videoDuration: input.duration,
          ...(input.creativeCommons ? { videoLicense: 'creativeCommon' } : {}),
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        }),
      );
    if (!data.success)
      throw new BadGatewayException('Resultados de pesquisa inválidos.');
    const ids = data.data.items.map((v) => v.id.videoId);
    const details = ids.length ? await this.details(ids) : [];
    return {
      items: ids
        .map((id) => details.find((v) => v.id === id))
        .filter((v): v is z.infer<typeof videoSchema> => !!v)
        .map((v) => this.map(v)),
      nextPageToken: data.data.nextPageToken ?? null,
      previousPageToken: data.data.prevPageToken ?? null,
    };
  }
  private async details(ids: string[]) {
    const parsed = z.object({ items: z.array(videoSchema).max(50) }).safeParse(
      await this.youtube.discoveryRequest('videos', {
        part: 'snippet,contentDetails,statistics,status',
        id: ids.join(','),
      }),
    );
    if (!parsed.success)
      throw new BadGatewayException('Metadados de vídeo inválidos.');
    return parsed.data.items;
  }
  async getVideoDetails(id: string) {
    const video = (await this.details([id]))[0];
    if (!video)
      throw new NotFoundException('Vídeo removido, privado ou indisponível.');
    return this.map(video);
  }
}
