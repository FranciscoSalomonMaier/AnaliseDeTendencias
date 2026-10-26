import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
export const digest = (v: string) =>
  createHash('sha256').update(v).digest('hex');
@Injectable()
export class YoutubeSecretBox {
  private readonly keys = new Map<string, Buffer>();
  private readonly keyId: string;
  constructor(config: ConfigService) {
    this.keyId = config.get<string>('YOUTUBE_ENCRYPTION_KEY_ID') ?? 'v1';
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(this.keyId))
      throw Error('YOUTUBE_ENCRYPTION_KEY_ID inválido');
    const add = (id: string, value: string) => {
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32 || key.toString('base64') !== value)
        throw Error('Chaves YouTube devem conter 32 bytes em base64');
      this.keys.set(id, key);
    };
    const previous = config.get<string>('YOUTUBE_PREVIOUS_ENCRYPTION_KEYS');
    if (previous) {
      const parsed: unknown = JSON.parse(previous);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw Error('Chaves anteriores inválidas');
      for (const [id, v] of Object.entries(parsed)) {
        if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(id))
          throw Error('Chaves anteriores inválidas');
        add(id, v);
      }
    }
    const current = config.get<string>('YOUTUBE_ENCRYPTION_KEY');
    if (current) add(this.keyId, current);
  }
  seal(value: string, context: string) {
    const key = this.keys.get(this.keyId);
    if (!key)
      throw new ServiceUnavailableException(
        'Configure a chave de criptografia YouTube.',
      );
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      this.keyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');
  }
  open(value: string, context: string) {
    try {
      const [id, iv, tag, data, ...rest] = value.split('.');
      const key = this.keys.get(id);
      if (!key || rest.length) throw Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(iv, 'base64url'),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException(
        'Credenciais indisponíveis. Verifique a chave de criptografia ou reconecte o canal.',
      );
    }
  }
}
