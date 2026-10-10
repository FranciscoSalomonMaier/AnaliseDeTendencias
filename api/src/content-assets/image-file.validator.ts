import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { extname } from 'node:path';
import sharp from 'sharp';
import {
  IMAGE_FORMATS,
  IMAGE_MAX_PIXELS,
  IMAGE_UPLOAD_MAX_BYTES,
} from './image-settings';

export interface ImageUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}
@Injectable()
export class ImageFileValidator {
  async validate(buffer: Buffer, declaredMime: string, filename?: string) {
    if (!buffer?.length)
      throw new BadRequestException('Envie um arquivo de imagem.');
    if (buffer.length > IMAGE_UPLOAD_MAX_BYTES)
      throw new PayloadTooLargeException('A imagem deve ter no máximo 10 MB.');
    if (!Object.values(IMAGE_FORMATS).some((f) => f.mime === declaredMime))
      throw new BadRequestException('Use somente PNG, JPEG ou WEBP.');
    try {
      const image = sharp(buffer, {
        limitInputPixels: IMAGE_MAX_PIXELS,
        failOn: 'warning',
        animated: true,
      });
      const metadata = await image.metadata();
      const format =
        IMAGE_FORMATS[metadata.format as keyof typeof IMAGE_FORMATS];
      if (
        !format ||
        format.mime !== declaredMime ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error('Formato, MIME ou dimensões inválidos');
      if (
        filename &&
        !(format.names as readonly string[]).includes(
          extname(filename).toLowerCase(),
        )
      )
        throw new Error('Extensão incompatível');
      // Decode all pixels, reject truncated payloads, and re-encode to discard metadata/trailing content.
      const clean = await image
        .rotate()
        .toFormat(metadata.format)
        .toBuffer({ resolveWithObject: true });
      if (clean.data.length > IMAGE_UPLOAD_MAX_BYTES)
        throw new PayloadTooLargeException('A imagem processada excede 10 MB.');
      return {
        image: clean.data,
        mimeType: format.mime,
        extension: format.extension,
        width: clean.info.width,
        height: clean.info.height,
      };
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw error;
      throw new BadRequestException(
        'Imagem inválida: conteúdo, extensão e MIME devem corresponder a PNG, JPEG ou WEBP estático.',
      );
    }
  }
}
