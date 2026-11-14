import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import ffprobe from 'ffprobe-static';
@Injectable()
export class RemixImportSettings {
  readonly maxBytes: number;
  readonly tempDir: string;
  readonly ffprobePath: string;
  readonly timeoutMs: number;
  constructor(c: ConfigService) {
    const mb = Number(c.get('VIDEO_REMIX_UPLOAD_MAX_MB') ?? 250);
    if (!Number.isInteger(mb) || mb < 1 || mb > 2048)
      throw new Error('VIDEO_REMIX_UPLOAD_MAX_MB deve estar entre 1 e 2048.');
    this.maxBytes = mb * 1024 * 1024;
    this.tempDir = resolve(
      c.get<string>('VIDEO_REMIX_UPLOAD_TEMP_DIR') ??
        'storage/remix-upload-tmp',
    );
    this.ffprobePath = c.get<string>('FFPROBE_PATH') ?? ffprobe.path;
    this.timeoutMs = 30000;
  }
}
export interface RemixUpload {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}
