import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { YoutubePublishingSettings, YOUTUBE_SCOPES } from './youtube-settings';
import { YoutubeSecretBox, digest } from './youtube-crypto';
import { YoutubePublishingRepository } from './youtube.repository';
import { YoutubeApiClient, YoutubeApiError } from './youtube-http';
import { publicChannel } from './youtube.schema';
interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.literal('Bearer').optional(),
});
const channelsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
        snippet: z.object({
          title: z.string().max(300),
          thumbnails: z
            .object({ default: z.object({ url: z.url() }).optional() })
            .optional(),
        }),
      }),
    )
    .min(1)
    .max(1),
});
@Injectable()
export class YoutubeOAuthService {
  constructor(
    readonly settings: YoutubePublishingSettings,
    readonly box: YoutubeSecretBox,
    readonly repo: YoutubePublishingRepository,
    readonly api: YoutubeApiClient,
  ) {}
  private requireConfigured() {
    if (!this.settings.configured)
      throw new ServiceUnavailableException(
        'Configure OAuth, CONTENT_ACCESS_KEY e a chave de criptografia do YouTube no servidor.',
      );
  }
  async authorize(browser: string) {
    this.requireConfigured();
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(48).toString('base64url');
    await this.repo.db.query(
      'DELETE FROM youtube_oauth_states WHERE expires_at<NOW()',
    );
    await this.repo.db.query(
      "INSERT INTO youtube_oauth_states(state_hash,owner_id,browser_hash,verifier,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')",
      [
        digest(state),
        this.settings.owner,
        digest(browser),
        this.box.seal(verifier, `oauth:${digest(state)}`),
      ],
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirect,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString() };
  }
  async callback(query: unknown, browser: string) {
    this.requireConfigured();
    const parsed = z
      .object({
        state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        code: z.string().min(1).max(4096).optional(),
        error: z.string().max(100).optional(),
        scope: z.string().optional(),
        authuser: z.string().optional(),
        prompt: z.string().optional(),
      })
      .safeParse(query);
    if (!parsed.success || !browser)
      throw new BadRequestException(
        'Callback OAuth inválido. Inicie a conexão novamente.',
      );
    const hash = digest(parsed.data.state);
    const consumed = await this.repo.db.query<{ verifier: string }>(
      'DELETE FROM youtube_oauth_states WHERE state_hash=$1 AND owner_id=$2 AND browser_hash=$3 AND expires_at>NOW() RETURNING verifier',
      [hash, this.settings.owner, digest(browser)],
    );
    if (!consumed.rows[0])
      throw new BadRequestException(
        'Autorização expirada, usada ou de outro navegador.',
      );
    if (parsed.data.error || !parsed.data.code)
      throw new BadRequestException(
        'A autorização Google foi negada ou cancelada.',
      );
    const verifier = this.box.open(consumed.rows[0].verifier, `oauth:${hash}`);
    const raw = await this.api.json<unknown>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: parsed.data.code,
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          redirect_uri: this.settings.redirect,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      },
    );
    const tokens = tokenSchema.safeParse(raw);
    if (!tokens.success) throw new YoutubeApiError('INVALID');
    const scopes = tokens.data.scope?.split(' ') ?? [];
    if (!YOUTUBE_SCOPES.every((s) => scopes.includes(s)))
      throw new BadRequestException(
        'Autorize as permissões de envio e consulta do canal.',
      );
    const channel = await this.identity(tokens.data.access_token);
    return this.repo.locked(
      'channel',
      `identity:${this.settings.owner}:${channel.id}`,
      async (client) => {
        const existing = (await this.repo.channels(this.settings.owner)).find(
          (c) => c.channel_id === channel.id,
        );
        const id = existing?.id ?? randomUUID();
        // A missing new refresh token must preserve only credentials for this exact channel.
        const previous = existing
          ? await this.repo.channel(this.settings.owner, id, client)
          : undefined;
        const old = previous?.credentials
          ? this.box.open(
              previous.credentials,
              `channel:${this.settings.owner}:${id}`,
            )
          : null;
        const oldCredentials = old ? (JSON.parse(old) as Credentials) : null;
        const refresh =
          tokens.data.refresh_token ?? oldCredentials?.refreshToken;
        if (!refresh)
          throw new BadRequestException(
            'O Google não forneceu acesso offline. Revogue o consentimento anterior e reconecte o canal.',
          );
        const credentials: Credentials = {
          accessToken: tokens.data.access_token,
          refreshToken: refresh,
          expiresAt: Date.now() + tokens.data.expires_in * 1000,
          scopes,
        };
        await client.query(
          "INSERT INTO youtube_channel_connections(id,owner_id,channel_id,title,thumbnail_url,credentials,status,verified_at) VALUES($1,$2,$3,$4,$5,$6,'CONNECTED',NOW()) ON CONFLICT(owner_id,channel_id) DO UPDATE SET title=EXCLUDED.title,thumbnail_url=EXCLUDED.thumbnail_url,credentials=EXCLUDED.credentials,status='CONNECTED',verified_at=NOW(),updated_at=NOW()",
          [
            id,
            this.settings.owner,
            channel.id,
            channel.snippet.title,
            channel.snippet.thumbnails?.default?.url ?? null,
            this.box.seal(
              JSON.stringify(credentials),
              `channel:${this.settings.owner}:${id}`,
            ),
          ],
        );
        await this.repo.event(this.settings.owner, 'CHANNEL_CONNECT', 'OK');
        return { channelId: channel.id, title: channel.snippet.title };
      },
    );
  }
  async identity(token: string) {
    const response = await this.api.json<unknown>(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const parsed = channelsSchema.safeParse(response);
    if (!parsed.success) throw new YoutubeApiError('CHANNEL');
    return parsed.data.items[0];
  }
  async token(id: string, force = false) {
    return this.repo.locked('channel', id, async (client) => {
      const row = await this.repo.channel(this.settings.owner, id, client);
      if (row.status !== 'CONNECTED' || !row.credentials)
        throw new YoutubeApiError('AUTH');
      const credentials = JSON.parse(
        this.box.open(row.credentials, `channel:${this.settings.owner}:${id}`),
      ) as Credentials;
      if (!force && credentials.expiresAt > Date.now() + 60000)
        return credentials.accessToken;
      try {
        const raw = await this.api.json<unknown>(
          'https://oauth2.googleapis.com/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: this.settings.clientId,
              client_secret: this.settings.clientSecret,
              refresh_token: credentials.refreshToken,
              grant_type: 'refresh_token',
            }),
          },
        );
        const parsed = tokenSchema.safeParse(raw);
        if (!parsed.success) throw new YoutubeApiError('INVALID');
        if (
          parsed.data.scope &&
          !YOUTUBE_SCOPES.every((s) =>
            parsed.data.scope!.split(' ').includes(s),
          )
        )
          throw new YoutubeApiError('AUTH');
        credentials.accessToken = parsed.data.access_token;
        credentials.expiresAt = Date.now() + parsed.data.expires_in * 1000;
        credentials.refreshToken =
          parsed.data.refresh_token ?? credentials.refreshToken;
        await client.query(
          'UPDATE youtube_channel_connections SET credentials=$3,updated_at=NOW() WHERE owner_id=$1 AND id=$2',
          [
            this.settings.owner,
            id,
            this.box.seal(
              JSON.stringify(credentials),
              `channel:${this.settings.owner}:${id}`,
            ),
          ],
        );
        await this.repo.event(this.settings.owner, 'TOKEN_REFRESH', 'OK');
        return credentials.accessToken;
      } catch (e) {
        if (e instanceof YoutubeApiError && e.code === 'AUTH')
          await client.query(
            "UPDATE youtube_channel_connections SET status='EXPIRED',updated_at=NOW() WHERE owner_id=$1 AND id=$2",
            [this.settings.owner, id],
          );
        throw e;
      }
    });
  }
  async verify(id: string) {
    const row = await this.repo.channel(this.settings.owner, id);
    if (
      row.status === 'CONNECTED' &&
      row.verified_at &&
      Date.now() - row.verified_at.getTime() < 30000
    )
      return publicChannel(row);
    const token = await this.token(id);
    const channel = await this.identity(token);
    if (channel.id !== row.channel_id) throw new YoutubeApiError('CHANNEL');
    await this.repo.db.query(
      'UPDATE youtube_channel_connections SET verified_at=NOW(),title=$3,updated_at=NOW() WHERE owner_id=$1 AND id=$2',
      [this.settings.owner, id, channel.snippet.title],
    );
    return publicChannel(await this.repo.channel(this.settings.owner, id));
  }
  async disconnect(id: string) {
    let revokeFailed = false;
    await this.repo.locked('channel', id, async (client) => {
      const row = await this.repo.channel(this.settings.owner, id, client);
      if (row.credentials) {
        try {
          const c = JSON.parse(
            this.box.open(
              row.credentials,
              `channel:${this.settings.owner}:${id}`,
            ),
          ) as Credentials;
          const r = await this.api.response(
            'https://oauth2.googleapis.com/revoke',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: c.refreshToken }),
            },
          );
          if (!r.ok) revokeFailed = true;
        } catch {
          revokeFailed = true;
        }
      }
      await client.query(
        "UPDATE youtube_channel_connections SET credentials=NULL,status='REVOKED',updated_at=NOW() WHERE owner_id=$1 AND id=$2",
        [this.settings.owner, id],
      );
      await client.query(
        "UPDATE youtube_publications SET cancel_requested=TRUE,status=CASE WHEN NOT session_started AND youtube_video_id IS NULL THEN 'CANCELLED' ELSE 'NEEDS_ATTENTION' END,error_code='AUTH',error_message='Canal desconectado. Confira o estado remoto antes de continuar.',updated_at=NOW() WHERE owner_id=$1 AND connection_id=$2 AND status IN ('DRAFT','QUEUED','UPLOADING','PROCESSING','SCHEDULED')",
        [this.settings.owner, id],
      );
      await client.query(
        "UPDATE youtube_automation_rules SET settings=jsonb_set(settings,'{enabled}','false'::jsonb),updated_at=NOW() WHERE owner_id=$1 AND settings->>'connectionId'=$2",
        [this.settings.owner, id],
      );
      await this.repo.event(
        this.settings.owner,
        'CHANNEL_DISCONNECT',
        revokeFailed ? 'LOCAL_ONLY' : 'REVOKED',
      );
    });
    return {
      disconnected: true,
      revokeFailed,
      message: revokeFailed
        ? 'Conexão local removida. Revogue também em myaccount.google.com/permissions.'
        : 'Autorização revogada; histórico preservado.',
    };
  }
}
