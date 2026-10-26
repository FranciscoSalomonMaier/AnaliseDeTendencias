import { YoutubePublishingRepository } from './youtube.repository';
import { YoutubePublishingSettings } from './youtube-settings';
import { Injectable, Optional } from '@nestjs/common';
export abstract class YoutubeHttpTransport {
  abstract send(
    url: string,
    init: RequestInit & { duplex?: 'half' },
  ): Promise<Response>;
}
@Injectable()
export class GoogleYoutubeTransport extends YoutubeHttpTransport {
  send(url: string, init: RequestInit & { duplex?: 'half' }) {
    return fetch(url, {
      ...init,
      redirect: 'manual',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000),
    });
  }
}
export class YoutubeApiError extends Error {
  constructor(
    readonly code: string,
    readonly transient = false,
    readonly httpStatus = 0,
    readonly retryAfterSeconds = 0,
  ) {
    super(
      messages[code] ??
        'A operação foi recusada pelo YouTube. Confira a conexão, as permissões e o histórico.',
    );
  }
}
const messages: Record<string, string> = {
  NETWORK:
    'Conexão com o Google interrompida. A sessão existente será consultada antes de retomar.',
  AUTH: 'Reconecte o canal para renovar a autorização.',
  QUOTA:
    'Cota ou limite de envio do YouTube atingido. Consulte o Google Cloud e tente novamente mais tarde.',
  PERMISSION:
    'Permissão recusada. Verifique o canal, os escopos e as restrições da conta.',
  SESSION_EXPIRED:
    'Sessão de upload expirada ou indisponível. O resultado remoto precisa de conferência; outro vídeo não será criado automaticamente.',
  UNCERTAIN:
    'O resultado remoto é incerto. Confira o YouTube Studio e reconcilie o vídeo; não será iniciado outro upload.',
  CHANNEL: 'O canal retornado não corresponde ao canal autorizado.',
  INVALID: 'Resposta ou metadados recusados pelo YouTube.',
  PROCESSING: 'O YouTube informou falha no processamento.',
  DISABLED: 'Uploads estão desabilitados no servidor.',
  LOCAL_FILE:
    'O arquivo local está indisponível ou não passou na validação. Confira o RenderJob antes de retomar.',
  SCHEDULE_PAST:
    'A data de publicação está muito próxima ou já passou. O arquivo não será enviado com uma data passada.',
  REMOTE_MISSING:
    'O vídeo não está disponível para esta autorização. Confira o YouTube Studio e a conexão do canal.',
};
export function retryDelay(raw: string | null) {
  if (!raw) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(raw)
    ? Number(raw)
    : (Date.parse(raw) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(0, seconds)) : 0;
}
export async function apiFailure(r: Response): Promise<YoutubeApiError> {
  let reason = '';
  try {
    const data = (await r.json()) as {
      error?: { errors?: Array<{ reason?: string }> } | string;
    };
    reason =
      typeof data.error === 'string'
        ? data.error
        : (data.error?.errors?.[0]?.reason ?? '');
  } catch {
    /* Do not expose upstream bodies. */
  }
  const quota = [
    'quotaExceeded',
    'dailyLimitExceeded',
    'uploadLimitExceeded',
    'dailyLimitExceededUnreg',
    'uploadRateLimitExceeded',
  ].includes(reason);
  const code =
    reason === 'invalid_grant' || r.status === 401
      ? 'AUTH'
      : quota
        ? 'QUOTA'
        : r.status === 403
          ? 'PERMISSION'
          : r.status >= 500 || r.status === 429
            ? 'NETWORK'
            : 'INVALID';
  const retry = retryDelay(r.headers.get('retry-after'));
  return new YoutubeApiError(
    code,
    !quota && (r.status >= 500 || r.status === 429),
    r.status,
    Number.isFinite(retry) ? Math.min(86400, retry) : 0,
  );
}
export function sessionUrl(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new YoutubeApiError('INVALID');
  }
  if (
    u.protocol !== 'https:' ||
    !['www.googleapis.com', 'youtube.googleapis.com'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    !u.pathname.startsWith('/upload/youtube/')
  )
    throw new YoutubeApiError('INVALID');
  return u.toString();
}
@Injectable()
export class YoutubeApiClient {
  constructor(
    readonly transport: YoutubeHttpTransport,
    @Optional() readonly repo?: YoutubePublishingRepository,
    @Optional() readonly settings?: YoutubePublishingSettings,
  ) {}
  private async audit(
    url: string,
    init: RequestInit,
    result: string,
    code?: string,
  ) {
    if (!this.repo || !this.settings) return;
    const path = new URL(url).pathname;
    const operation = path.endsWith('/token')
      ? 'OAUTH_TOKEN'
      : path.endsWith('/revoke')
        ? 'OAUTH_REVOKE'
        : path.endsWith('/channels')
          ? 'CHANNEL_LIST'
          : path.endsWith('/thumbnails/set')
            ? 'THUMBNAILS_SET'
            : path.includes('/upload/')
              ? init.method === 'POST'
                ? 'VIDEOS_INSERT'
                : String(
                      (init.headers as Record<string, string>)?.[
                        'Content-Range'
                      ] ?? '',
                    ).startsWith('bytes */')
                  ? 'UPLOAD_STATUS'
                  : 'UPLOAD_CHUNK'
              : 'VIDEOS_LIST';
    await this.repo
      .event(this.settings.owner, operation, result, undefined, code)
      .catch(() => undefined);
  }
  async response(url: string, init: RequestInit & { duplex?: 'half' } = {}) {
    try {
      const result = await this.transport.send(url, init);
      await this.audit(
        url,
        init,
        result.ok || result.status === 308 ? 'OK' : 'FAILED',
        `HTTP_${result.status}`,
      );
      return result;
    } catch {
      await this.audit(url, init, 'FAILED', 'NETWORK');
      throw new YoutubeApiError('NETWORK', true);
    }
  }
  async json<T>(
    url: string,
    init: RequestInit & { duplex?: 'half' } = {},
  ): Promise<T> {
    const r = await this.response(url, init);
    if (!r.ok) throw await apiFailure(r);
    try {
      return (await r.json()) as T;
    } catch {
      throw new YoutubeApiError('INVALID');
    }
  }
}
