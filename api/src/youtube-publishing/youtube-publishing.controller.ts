import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { YoutubePublicationService } from './youtube-publication.service';
import { YoutubeOAuthService } from './youtube-oauth.service';
import { YoutubePublishingRepository } from './youtube.repository';
import { YoutubePublishingSettings } from './youtube-settings';
import { publicPublication } from './youtube.schema';
import { YoutubeApiError } from './youtube-http';
const confirm = z.object({ confirm: z.literal(true) }).strict();
@Controller('youtube-publishing')
export class YoutubePublishingController {
  constructor(
    readonly service: YoutubePublicationService,
    readonly oauth: YoutubeOAuthService,
    readonly repo: YoutubePublishingRepository,
    readonly settings: YoutubePublishingSettings,
  ) {}
  private async run<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (e) {
      if (e instanceof YoutubeApiError)
        throw new HttpException(
          { message: e.message, code: e.code },
          e.code === 'AUTH' ? 401 : e.code === 'QUOTA' ? 429 : 502,
        );
      throw e;
    }
  }
  private confirmed(body: unknown) {
    if (!confirm.safeParse(body).success)
      throw new BadRequestException('Confirme a operação.');
  }
  @Get('operations') async operations() {
    return (
      await this.repo.db.query(
        "SELECT operation,result,code,count(*)::int AS attempts FROM youtube_publication_events WHERE owner_id=$1 AND created_at>NOW()-INTERVAL '24 hours' GROUP BY operation,result,code ORDER BY operation",
        [this.settings.owner],
      )
    ).rows;
  }
  @Get('configuration') configuration() {
    return this.service.configuration();
  }
  @Post('oauth/authorize') authorize(
    @Body() body: unknown,
    @Res() response: Response,
  ) {
    this.confirmed(body);
    return this.run(async () => {
      const browser = randomBytes(32).toString('base64url');
      const result = await this.oauth.authorize(browser);
      response.cookie('youtube_oauth_browser', browser, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.settings.config.get<string>('NODE_ENV') === 'production',
        path: '/youtube-publishing/oauth',
        maxAge: 600000,
      });
      response.set('Cache-Control', 'no-store');
      response.json(result);
    });
  }
  @Get('oauth/callback') async callback(
    @Query() query: unknown,
    @Req() req: Request,
    @Res() response: Response,
  ) {
    const browser =
      req.headers.cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('youtube_oauth_browser='))
        ?.slice('youtube_oauth_browser='.length) ?? '';
    let status = 'connected';
    try {
      await this.oauth.callback(query, browser);
    } catch {
      status = 'denied_or_expired';
    }
    response.clearCookie('youtube_oauth_browser', {
      path: '/youtube-publishing/oauth',
    });
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    const url = new URL(this.settings.frontend);
    url.search = new URLSearchParams({
      page: 'youtube-integration',
      youtubeOAuth: status,
    }).toString();
    response.redirect(303, url.toString());
  }
  @Post('channels/:id/verify') verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    this.confirmed(body);
    return this.run(() => this.oauth.verify(id));
  }
  @Delete('channels/:id') disconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    this.confirmed(body);
    return this.run(() => this.oauth.disconnect(id));
  }
  @Post('publications/validate') validate(@Body() body: unknown) {
    return this.run(async () => {
      const r = await this.service.validate(body);
      return {
        valid: true,
        warnings: r.warnings,
        title: r.snapshot.title,
        channelTitle: r.channel.title,
        privacy: r.snapshot.options.privacy,
        scheduledAt: r.snapshot.options.scheduledAt,
      };
    });
  }
  @Post('publications') create(@Body() body: unknown) {
    return this.run(() => this.service.create(body));
  }
  @Get('publications') list(@Query() query: unknown) {
    const parsed = z
      .object({
        channel: z.uuid().optional(),
        status: z
          .enum([
            'DRAFT',
            'QUEUED',
            'UPLOADING',
            'PROCESSING',
            'SCHEDULED',
            'PUBLISHED',
            'PRIVATE',
            'UNLISTED',
            'FAILED',
            'CANCELLED',
            'NEEDS_ATTENTION',
          ])
          .optional(),
        project: z.uuid().optional(),
      })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException('Filtros inválidos.');
    return this.run(async () => ({
      publications: (
        await this.repo.list(
          this.settings.owner,
          parsed.data.channel,
          parsed.data.status,
          parsed.data.project,
        )
      ).map(publicPublication),
    }));
  }
  @Get('publications/:id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.run(async () => ({
      publication: publicPublication(
        await this.repo.publication(this.settings.owner, id),
      ),
      events: await this.repo.events(this.settings.owner, id),
    }));
  }
  @Post('publications/:id/upload') upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    this.confirmed(body);
    return this.run(() => this.service.queue(id));
  }
  @Post('publications/:id/retry') retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    this.confirmed(body);
    return this.run(() => this.service.retry(id));
  }
  @Post('publications/:id/cancel') cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    this.confirmed(body);
    return this.run(async () => {
      await this.repo.cancel(this.settings.owner, id);
      await this.repo.event(
        this.settings.owner,
        'LOCAL_CANCEL',
        'REQUESTED',
        id,
      );
      return publicPublication(
        await this.repo.publication(this.settings.owner, id),
      );
    });
  }
  @Post('publications/:id/status') status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({
        confirm: z.literal(true),
        videoId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{11}$/)
          .optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Confirme o ID do vídeo.');
    return this.run(() => this.service.reconcile(id, parsed.data.videoId));
  }
  @Post('publications/:id/thumbnail/retry') thumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    this.confirmed(body);
    return this.run(() => this.service.retryThumbnail(id));
  }
  @Get('automation/:projectId') async automation(
    @Param('projectId', ParseUUIDPipe) id: string,
  ) {
    return { settings: await this.repo.rule(this.settings.owner, id) };
  }
  @Patch('automation/:projectId') saveAutomation(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.run(() => this.service.saveAutomation(id, body));
  }
}
