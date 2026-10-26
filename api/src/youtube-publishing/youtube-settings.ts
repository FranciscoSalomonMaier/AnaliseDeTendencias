import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
@Injectable()
export class YoutubePublishingSettings {
  readonly owner: string;
  readonly uploads: boolean;
  readonly publicPublication: boolean;
  readonly configured: boolean;
  readonly frontend: string;
  readonly redirect: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly chunkBytes = 8 * 1024 * 1024;
  readonly timeoutMs = 120000;
  readonly maxAttempts = 6;
  constructor(readonly config: ConfigService) {
    const flag = (key: string) => {
      const v = config.get<string>(key) ?? 'false';
      if (!['true', 'false'].includes(v)) throw Error(`${key} inválido`);
      return v === 'true';
    };
    this.owner = config.get<string>('CONTENT_OWNER_ID') ?? 'local-owner';
    this.uploads = flag('YOUTUBE_UPLOADS_ENABLED');
    this.publicPublication = flag('YOUTUBE_PUBLIC_PUBLICATION_ENABLED');
    this.frontend =
      config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    this.redirect =
      config.get<string>('YOUTUBE_REDIRECT_URI') ??
      'http://localhost:3000/youtube-publishing/oauth/callback';
    this.clientId = config.get<string>('YOUTUBE_CLIENT_ID') ?? '';
    this.clientSecret = config.get<string>('YOUTUBE_CLIENT_SECRET') ?? '';
    this.configured = Boolean(
      this.clientId &&
      this.clientSecret &&
      config.get<string>('YOUTUBE_ENCRYPTION_KEY') &&
      config.get<string>('CONTENT_ACCESS_KEY'),
    );
    for (const value of [this.frontend, this.redirect]) {
      const u = new URL(value);
      if (
        u.username ||
        u.password ||
        !['http:', 'https:'].includes(u.protocol) ||
        u.hash ||
        u.search
      )
        throw Error('URL YouTube inválida');
      if (
        this.configured &&
        config.get<string>('NODE_ENV') === 'production' &&
        u.protocol !== 'https:'
      )
        throw Error('YouTube exige HTTPS em produção');
    }
    if (
      new URL(this.redirect).pathname !== '/youtube-publishing/oauth/callback'
    )
      throw Error(
        'YOUTUBE_REDIRECT_URI deve apontar para /youtube-publishing/oauth/callback',
      );
  }
}
