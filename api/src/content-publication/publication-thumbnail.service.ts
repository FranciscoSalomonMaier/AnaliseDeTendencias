import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { StorageProvider } from '../content-assets/storage.provider';
import { ImageProvider } from '../content-assets/image.provider';
import { PublicationRepository } from './publication.repository';
import { textOverlaySchema } from './publication.schema';
import type { z } from 'zod';
export type Overlay = z.infer<typeof textOverlaySchema>;
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024; // Conservative export, also compatible with mobile uploads.
const escapeXml = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
export async function composeThumbnail(input: Buffer, overlay: Overlay) {
  if (!input.length || input.length > 10 * 1024 * 1024)
    throw new BadRequestException('Thumbnail deve ter até 10 MB na entrada.');
  const source = sharp(input, { limitInputPixels: 24000000 });
  let meta: sharp.Metadata;
  try {
    meta = await source.metadata();
  } catch {
    throw new BadRequestException('Imagem inválida. Envie JPEG ou PNG.');
  }
  if (
    !['jpeg', 'png'].includes(meta.format ?? '') ||
    !meta.width ||
    !meta.height ||
    meta.width < 640 ||
    meta.height < 360 ||
    Number(meta.pages ?? 1) > 1
  )
    throw new BadRequestException(
      'Envie JPEG ou PNG estático com pelo menos 640 × 360 pixels.',
    );
  const width = overlay.aspectRatio === '9:16' ? 720 : 1280;
  const canvasHeight = overlay.aspectRatio === '9:16' ? 1280 : 720;
  let base = await sharp(input, { limitInputPixels: 24000000 })
    .rotate()
    .resize(width, canvasHeight, { fit: 'contain', background: '#101018' })
    .png()
    .toBuffer();
  if (overlay.enabled && overlay.text) {
    const max = Math.floor((width - 160) / overlay.fontSize);
    const words = overlay.text.split(/\s+/u);
    const lines: string[] = [];
    for (const word of words) {
      if (word.length > max)
        throw new BadRequestException(
          'Texto muito longo sem espaços. Reduza o texto ou a fonte.',
        );
      if (!lines.length || lines.at(-1)!.length + word.length + 1 > max)
        lines.push(word);
      else lines[lines.length - 1] += ' ' + word;
    }
    const height = lines.length * overlay.fontSize * 1.2;
    if (height > canvasHeight - 140)
      throw new BadRequestException(
        'Texto excede a área segura. Reduza a fonte.',
      );
    const y =
      overlay.position === 'TOP'
        ? 70
        : overlay.position === 'CENTER'
          ? (canvasHeight - height) / 2
          : canvasHeight - 70 - height;
    const channels = [1, 3, 5].map((i) =>
      parseInt(overlay.color.slice(i, i + 2), 16),
    );
    const dark =
      channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114 < 128;
    const backing = dark ? '#FFFFFF' : '#000000';
    const text = lines
      .map(
        (line, i) =>
          `<text x="${width / 2}" y="${y + overlay.fontSize * (i * 1.2 + 1)}" text-anchor="middle" font-family="Liberation Sans,DejaVu Sans,sans-serif" font-size="${overlay.fontSize}" font-weight="bold" fill="${overlay.color}" stroke="${backing}" stroke-width="${overlay.outline ? 6 : 0}" paint-order="stroke">${escapeXml(line)}</text>`,
      )
      .join('');
    base = await sharp(base)
      .composite([
        {
          input: Buffer.from(
            `<svg width="${width}" height="${canvasHeight}"><rect x="30" y="${y - 10}" width="${width - 60}" height="${height + 35}" rx="16" fill="${backing}" fill-opacity="0.58"/>${text}</svg>`,
          ),
        },
      ])
      .png()
      .toBuffer();
  }
  const output = await sharp(base)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  if (output.length >= THUMBNAIL_MAX_BYTES)
    throw new BadRequestException(
      'Thumbnail final excedeu o limite de exportação de 2 MB.',
    );
  return output;
}
@Injectable()
export class PublicationThumbnailService {
  constructor(
    private readonly db: PostgresDatabaseService,
    private readonly assets: ContentAssetRepository,
    private readonly storage: StorageProvider,
    private readonly repository: PublicationRepository,
    private readonly image: ImageProvider,
  ) {}
  async create(
    projectId: string,
    input: Buffer,
    overlay: Overlay,
    details: {
      source: 'AI_GENERATED' | 'USER_UPLOAD';
      prompt?: string;
      provider?: string;
      model?: string;
      usage?: unknown;
    },
    backgroundKey?: string,
  ) {
    const output = await composeThumbnail(input, overlay),
      id = randomUUID(),
      assetId = randomUUID();
    const raw =
        backgroundKey ?? `${projectId}/publication/${id}/background.png`,
      key = `${projectId}/publication/${id}/thumbnail.jpg`;
    if (!backgroundKey)
      await this.storage.save(
        raw,
        await sharp(input).rotate().png().toBuffer(),
      );
    try {
      await this.storage.save(key, output);
      await this.db.withClient(async (client) => {
        await client.query('BEGIN');
        try {
          await this.repository.ensure(projectId, client);
          await client.query(
            `INSERT INTO content_assets(id,project_id,type,source,status,usage,storage_key,mime_type,width,height,provider,model,original_prompt,final_generation_prompt,metadata,token_usage) VALUES($1,$2,'IMAGE',$3,'READY','OPTIONAL',$4,'image/jpeg',$10,$11,$5,$6,$7,$7,$8::jsonb,$9::jsonb)`,
            [
              assetId,
              projectId,
              details.source,
              key,
              details.provider ?? null,
              details.model ?? null,
              details.prompt ?? null,
              JSON.stringify({
                assetRole: 'PUBLICATION_THUMBNAIL',
                bytes: output.length,
                overlay,
              }),
              JSON.stringify(details.usage ?? null),
              overlay.aspectRatio === '9:16' ? 720 : 1280,
              overlay.aspectRatio === '9:16' ? 1280 : 720,
            ],
          );
          await client.query(
            'INSERT INTO content_publication_thumbnails(id,project_id,asset_id,background_key,overlay) VALUES($1,$2,$3,$4,$5::jsonb)',
            [id, projectId, assetId, raw, JSON.stringify(overlay)],
          );
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => {});
      if (!backgroundKey) await this.storage.delete(raw).catch(() => {});
      throw e;
    }
    return {
      id,
      assetId,
      provider: details.provider ?? null,
      model: details.model ?? null,
    };
  }
  async generate(
    projectId: string,
    prompt: string,
    overlay: Overlay,
    style: string,
  ) {
    const result = await this.image.generate({
      prompt,
      style,
      aspectRatio: overlay.aspectRatio ?? '16:9',
    });
    return this.create(projectId, result.image, overlay, {
      source: 'AI_GENERATED',
      prompt,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    });
  }
  async recompose(projectId: string, id: string, overlay: Overlay) {
    const original = await this.repository.thumbnail(projectId, id);
    if (!original)
      throw new NotFoundException('Thumbnail não pertence ao projeto.');
    const asset = await this.assets.get(projectId, original.asset_id);
    return this.create(
      projectId,
      await this.storage.read(original.background_key),
      overlay,
      {
        source:
          asset.source === 'AI_GENERATED' ? 'AI_GENERATED' : 'USER_UPLOAD',
        provider: asset.provider ?? undefined,
        model: asset.model ?? undefined,
        prompt: asset.originalPrompt ?? undefined,
      },
      original.background_key,
    );
  }
  async file(projectId: string, id: string) {
    const row = await this.repository.thumbnail(projectId, id);
    if (!row) throw new NotFoundException('Thumbnail não pertence ao projeto.');
    const asset = await this.assets.get(projectId, row.asset_id);
    if (asset.status !== 'READY' || !asset.storageKey)
      throw new NotFoundException('Thumbnail indisponível.');
    const buffer = await this.storage.read(asset.storageKey).catch(() => {
      throw new NotFoundException('Arquivo da thumbnail indisponível.');
    });
    if (buffer.length >= THUMBNAIL_MAX_BYTES)
      throw new BadRequestException('Arquivo acima do limite.');
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer, { limitInputPixels: 24000000 }).metadata();
    } catch {
      throw new BadRequestException('Thumbnail final inválida.');
    }
    if (
      metadata.format !== 'jpeg' ||
      metadata.width !== (asset.width ?? 1280) ||
      metadata.height !== (asset.height ?? 720)
    )
      throw new BadRequestException(
        'Capa final deve ser JPEG com as dimensões registradas.',
      );
    return buffer;
  }
}
