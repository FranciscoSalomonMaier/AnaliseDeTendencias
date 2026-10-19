import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Post,
  Body,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PostgresDatabaseService } from '../database/postgres-database.service';
@Injectable()
export class ContentAccessGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly db: PostgresDatabaseService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl.split('?')[0];
    if (!path.startsWith('/content-projects')) return true;
    const configured = this.config.get<string>('CONTENT_ACCESS_KEY');
    if (!configured) {
      if (path.includes('/publication'))
        throw new ServiceUnavailableException(
          'Configure CONTENT_ACCESS_KEY no servidor para habilitar a preparação de publicação.',
        );
      return true;
    }
    const token =
      req.headers.authorization?.replace(/^Bearer /u, '') ??
      req.headers.cookie
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('content_access='))
        ?.slice('content_access='.length);
    let decoded = token;
    try {
      if (!req.headers.authorization && token)
        decoded = decodeURIComponent(token);
    } catch {
      decoded = undefined;
    }
    if (
      !decoded ||
      Buffer.byteLength(decoded) !== Buffer.byteLength(configured) ||
      !timingSafeEqual(Buffer.from(decoded), Buffer.from(configured))
    )
      throw new UnauthorizedException(
        'Entre com a chave de acesso do estúdio.',
      );
    const projectId =
      typeof req.params.projectId === 'string'
        ? req.params.projectId
        : typeof req.params.id === 'string'
          ? req.params.id
          : undefined;
    if (projectId) {
      if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/iu.test(projectId))
        throw new BadRequestException('ID de projeto inválido.');
      const result = await this.db.query<{ owner_id: string | null }>(
        'SELECT owner_id FROM content_generation_runs WHERE generation_id=$1',
        [projectId],
      );
      const owner =
        this.config.get<string>('CONTENT_OWNER_ID') ?? 'local-owner';
      if (result.rows[0]?.owner_id && result.rows[0].owner_id !== owner)
        throw new ForbiddenException('Projeto pertence a outro proprietário.');
    }
    return true;
  }
}
@Controller('content-access')
export class ContentAccessController {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly config: ConfigService) {}
  @Post('session') login(@Body() body: unknown, @Res() res: Response) {
    const key = this.config.get<string>('CONTENT_ACCESS_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'Configure CONTENT_ACCESS_KEY no backend.',
      );
    const token = (body as { key?: unknown })?.key;
    // Bounded global rate limit protects the local access gate without storing keys.
    const now = Date.now(),
      attempt = this.attempts.get('login');
    if (attempt && attempt.until > now && attempt.count >= 10)
      throw new UnauthorizedException('Muitas tentativas. Aguarde um minuto.');
    this.attempts.set('login', {
      count: attempt && attempt.until > now ? attempt.count + 1 : 1,
      until: attempt && attempt.until > now ? attempt.until : now + 60000,
    });
    if (
      typeof token !== 'string' ||
      Buffer.byteLength(token) !== Buffer.byteLength(key) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(key))
    )
      throw new UnauthorizedException('Chave de acesso inválida.');
    this.attempts.delete('login');
    res.cookie('content_access', key, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ authenticated: true });
  }
}
