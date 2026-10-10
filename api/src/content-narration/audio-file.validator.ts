import { Injectable, BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';
import { TtsSettings } from './tts-settings';
export interface AudioUpload {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}
@Injectable()
export class AudioFileValidator {
  constructor(private readonly settings: TtsSettings) {}
  async validate(buffer: Buffer, mime: string, filename?: string) {
    if (!buffer.length || buffer.length > this.settings.uploadMaxBytes)
      throw new BadRequestException('Áudio vazio ou acima do limite de 20 MB.');
    const wav =
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE';
    const mp3 =
      buffer.toString('ascii', 0, 3) === 'ID3' ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    const extension = wav ? 'wav' : mp3 ? 'mp3' : null;
    if (
      wav &&
      (buffer.length < 44 || buffer.readUInt32LE(4) + 8 !== buffer.length)
    )
      throw new BadRequestException('Arquivo WAV truncado ou inválido.');
    if (!extension)
      throw new BadRequestException(
        'Conteúdo inválido. Envie um arquivo MP3 ou WAV.',
      );
    const validMimes =
      extension === 'wav'
        ? ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']
        : ['audio/mpeg', 'audio/mp3'];
    if (
      !validMimes.includes(mime) ||
      (filename && extname(filename).toLowerCase() !== `.${extension}`)
    )
      throw new BadRequestException(
        'Extensão, MIME e conteúdo do áudio não correspondem.',
      );
    try {
      const { parseBuffer } = await import('music-metadata');
      const metadata = await parseBuffer(
        buffer,
        { mimeType: validMimes[0], size: buffer.length },
        { duration: true, skipCovers: true },
      );
      const f = metadata.format;
      if (
        (extension === 'mp3' &&
          (f.container !== 'MPEG' ||
            !/^MPEG (1|2|2.5) Layer 3$/.test(f.codec ?? ''))) ||
        (extension === 'wav' &&
          (f.container !== 'WAVE' || !f.codec?.startsWith('PCM')))
      )
        throw new Error('Unsupported codec');
      const durationSeconds = f.duration;
      if (
        !durationSeconds ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > this.settings.maxDurationSeconds ||
        !f.sampleRate ||
        !f.numberOfChannels ||
        f.numberOfChannels > 2
      )
        throw new Error('Invalid duration or stream');
      // WAV/MP3 bytes stay unchanged: no transcoding; parser validation precedes persistence.
      return {
        audio: buffer,
        extension,
        mimeType: validMimes[0],
        durationSeconds,
        metadata: {
          codec: f.codec,
          sampleRate: f.sampleRate,
          channels: f.numberOfChannels,
        },
      };
    } catch {
      throw new BadRequestException(
        'Não foi possível validar o áudio ou sua duração (máximo 10 minutos).',
      );
    }
  }
}
