import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoRemixRepository } from './video-remix.repository';
import type { Request } from 'express';
@Injectable()
export class RemixUploadGuard implements CanActivate {
  constructor(
    private readonly repo: VideoRemixRepository,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (!this.config.get('CONTENT_ACCESS_KEY'))
      throw new ServiceUnavailableException('Configure CONTENT_ACCESS_KEY.');
    const id = req.params.projectId;
    if (
      typeof id !== 'string' ||
      !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)
    )
      throw new BadRequestException('ID inválido.');
    const p = await this.repo.get(
      id,
      this.config.get<string>('CONTENT_OWNER_ID') ?? 'local-owner',
    );
    if (p.status !== 'DRAFT')
      throw new BadRequestException(
        'Importação permitida apenas em rascunhos.',
      );
    return true;
  }
}
