import { Injectable } from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import { z } from 'zod';
import {
  YoutubeApiClient,
  apiFailure,
  YoutubeApiError,
  sessionUrl,
  retryDelay,
} from './youtube-http';
import { YoutubePublishingSettings } from './youtube-settings';
import type {
  YoutubePublicationSnapshot,
  PublicationStatus,
} from './youtube.schema';
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const remoteVideoSchema = z.object({
  id: videoId,
  snippet: z
    .object({ channelId: z.string(), title: z.string().optional() })
    .optional(),
  status: z
    .object({
      privacyStatus: z.enum(['private', 'unlisted', 'public']),
      uploadStatus: z.string(),
      publishAt: z.string().optional(),
      failureReason: z.string().optional(),
      rejectionReason: z.string().optional(),
    })
    .optional(),
  processingDetails: z.object({ processingStatus: z.string() }).optional(),
});
export type RemoteVideo = z.infer<typeof remoteVideoSchema>;
export function remoteStatus(video: RemoteVideo): PublicationStatus {
  if (!video.status) return 'NEEDS_ATTENTION';
  if (
    ['failed', 'rejected', 'deleted'].includes(video.status.uploadStatus) ||
    ['failed', 'terminated'].includes(
      video.processingDetails?.processingStatus ?? '',
    )
  )
    return 'FAILED';
  if (
    video.status.uploadStatus !== 'processed' ||
    (video.processingDetails &&
      video.processingDetails.processingStatus !== 'succeeded')
  )
    return 'PROCESSING';
  if (video.status.privacyStatus === 'public') return 'PUBLISHED';
  if (video.status.privacyStatus === 'unlisted') return 'UNLISTED';
  if (video.status.publishAt && Date.parse(video.status.publishAt) > Date.now())
    return 'SCHEDULED';
  return 'PRIVATE';
}
export function confirmedOffset(response: Response, total: number) {
  const range = response.headers.get('range');
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total)
    throw new YoutubeApiError('INVALID');
  return offset;
}
@Injectable()
export class YoutubeUploadService {
  constructor(
    readonly api: YoutubeApiClient,
    readonly settings: YoutubePublishingSettings,
  ) {}
  async initiate(token: string, s: YoutubePublicationSnapshot) {
    if (
      s.options.scheduledAt &&
      Date.parse(s.options.scheduledAt) <= Date.now() + 60000
    )
      throw new YoutubeApiError('INVALID');
    const body = {
      snippet: {
        title: s.title,
        description: s.description,
        tags: s.tags,
        categoryId: s.options.categoryId,
        defaultLanguage: s.language,
      },
      status: {
        privacyStatus: s.options.privacy,
        selfDeclaredMadeForKids: s.options.madeForKids,
        containsSyntheticMedia: s.options.containsSyntheticMedia,
        license: s.options.license,
        ...(s.options.scheduledAt ? { publishAt: s.options.scheduledAt } : {}),
      },
    };
    const response = await this.api.response(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(s.bytes),
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw await apiFailure(response);
    const location = response.headers.get('location');
    if (!location) throw new YoutubeApiError('UNCERTAIN');
    return sessionUrl(location);
  }
  async result(
    response: Response,
    total: number,
  ): Promise<{ offset: number; videoId?: string; retryAfter?: number }> {
    if (response.status === 308) {
      const raw = retryDelay(response.headers.get('retry-after'));
      return {
        offset: confirmedOffset(response, total),
        retryAfter: Number.isFinite(raw)
          ? Math.max(0, Math.min(86400, raw))
          : 0,
      };
    }
    if ([404, 410].includes(response.status))
      throw new YoutubeApiError('SESSION_EXPIRED');
    if (!response.ok) throw await apiFailure(response);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new YoutubeApiError('UNCERTAIN');
    }
    const parsed = remoteVideoSchema.safeParse(raw);
    if (!parsed.success) throw new YoutubeApiError('UNCERTAIN');
    return { offset: total, videoId: parsed.data.id };
  }
  async inspect(
    token: string,
    url: string,
    total: number,
    signal?: AbortSignal,
  ) {
    const response = await this.api.response(sessionUrl(url), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Length': '0',
        'Content-Range': `bytes */${total}`,
      },
      signal,
    });
    return this.result(response, total);
  }
  async chunk(
    token: string,
    url: string,
    total: number,
    start: number,
    end: number,
    stream: ReadStream,
    signal?: AbortSignal,
  ) {
    try {
      const response = await this.api.response(sessionUrl(url), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Length': String(end - start + 1),
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${total}`,
        },
        body: stream as unknown as BodyInit,
        duplex: 'half',
        signal,
      });
      return await this.result(response, total);
    } finally {
      stream.destroy();
    }
  }
  async video(token: string, id: string) {
    if (!videoId.safeParse(id).success) throw new YoutubeApiError('INVALID');
    const data = await this.api.json<{ items?: unknown[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!data.items?.length) throw new YoutubeApiError('REMOTE_MISSING');
    const parsed = remoteVideoSchema.safeParse(data.items[0]);
    if (!parsed.success) throw new YoutubeApiError('INVALID');
    return parsed.data;
  }
  async thumbnail(token: string, id: string, data: Buffer) {
    if (!videoId.safeParse(id).success || data.length > 2 * 1024 * 1024)
      throw new YoutubeApiError('INVALID');
    await this.api.json<unknown>(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(id)}&uploadType=media`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'image/jpeg',
          'Content-Length': String(data.length),
        },
        body: data as unknown as BodyInit,
      },
    );
  }
}
