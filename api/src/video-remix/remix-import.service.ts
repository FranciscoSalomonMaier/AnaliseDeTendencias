import { youtubeIdFromUrl } from './remix-url';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { VideoRemixService } from './video-remix.service';
import { VideoRemixRepository } from './video-remix.repository';
import { RemixDiscoveryService } from './remix-discovery.service';
import { RemixFilesService } from './remix-files.service';
import { RemixVideoValidator } from './remix-video.validator';
import {
  candidateSchema,
  attachSchema,
  rightsSchema,
} from './discovery.schema';
import { remixDeleteSchema } from './video-remix.schema';
import type { RemixUpload } from './remix-import.settings';
@Injectable()
export class RemixImportService {
  constructor(
    private readonly projects: VideoRemixService,
    private readonly repo: VideoRemixRepository,
    private readonly discovery: RemixDiscoveryService,
    private readonly files: RemixFilesService,
    private readonly validator: RemixVideoValidator,
  ) {}
  async candidates(project: string) {
    await this.authorize(project);
    const sources = await this.projects.listSources(project);
    return { items: sources.items.filter((s) => s.platform === 'YOUTUBE') };
  }
  async authorize(project: string) {
    await this.repo.get(project, this.projects.owner());
  }
  async search(project: string, body: unknown) {
    await this.authorize(project);
    return this.discovery.search(this.projects.owner(), body);
  }
  async details(project: string, id: string) {
    await this.authorize(project);
    return this.discovery.details(this.projects.owner(), id);
  }
  async candidate(project: string, body: unknown) {
    const p = candidateSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Candidato inválido.');
    await this.authorize(project);
    const video = await this.discovery.details(
      this.projects.owner(),
      p.data.externalId,
    );
    if (video.eligibility === 'UNAVAILABLE')
      throw new BadRequestException('Vídeo indisponível como candidato.');
    return this.repo.locked(
      project,
      this.projects.owner(),
      p.data.revision,
      async (pr, c) => {
        const sources = await this.repo.sources(project, c);
        const duplicate = sources.find(
          (s) =>
            (s.platform === 'YOUTUBE' && s.externalId === video.externalId) ||
            youtubeIdFromUrl(s.originalUrl) === video.externalId,
        );
        if (duplicate) {
          if (duplicate.externalId === video.externalId)
            return { project: pr, source: duplicate };
          await c.query(
            "UPDATE video_remix_sources SET platform='YOUTUBE',external_id=$3,platform_metadata=$4::jsonb,platform_metadata_expires_at=NOW()+INTERVAL '30 days',status=CASE WHEN imported_file_id IS NULL THEN 'SELECTED' ELSE status END WHERE project_id=$1 AND id=$2",
            [project, duplicate.id, video.externalId, JSON.stringify(video)],
          );
          await this.repo.save(pr, c);
          return {
            project: await this.repo.get(project, this.projects.owner(), c),
            source: (await this.repo.sources(project, c)).find(
              (s) => s.id === duplicate.id,
            ),
          };
        }
        if (pr.mode === 'SINGLE_SOURCE' && sources.length) {
          if (
            !p.data.confirmReplacement ||
            p.data.replaceSourceId !== sources[0].id
          )
            throw new ConflictException(
              'Single Source já possui fonte. Confirme explicitamente sua substituição.',
            );
          await c.query(
            'DELETE FROM video_remix_sources WHERE project_id=$1 AND id=$2',
            [project, p.data.replaceSourceId],
          );
        }
        if (pr.mode === 'MULTI_SOURCE' && sources.length >= 100)
          throw new ConflictException('Limite de fontes atingido.');
        const id = randomUUID();
        await c.query(
          "INSERT INTO video_remix_sources(id,project_id,title,origin_type,original_url,duration_seconds,status,licensing,platform,external_id,platform_metadata,platform_metadata_expires_at) VALUES($1,$2,$3,'EXTERNAL_URL',$4,$5,'SELECTED',$6::jsonb,'YOUTUBE',$7,$8::jsonb,NOW()+INTERVAL '30 days')",
          [
            id,
            project,
            video.title,
            video.originalUrl,
            video.durationSeconds,
            JSON.stringify({ authorization: 'UNKNOWN', notes: '' }),
            video.externalId,
            JSON.stringify(video),
          ],
        );
        await this.repo.save(pr, c);
        return {
          project: await this.repo.get(project, this.projects.owner(), c),
          source: (await this.repo.sources(project, c)).find(
            (s) => s.id === id,
          ),
        };
      },
    );
  }
  private async source(project: string, id: string, c: PoolClient) {
    const s = (await this.repo.sources(project, c)).find((s) => s.id === id);
    if (!s) throw new BadRequestException('Fonte não pertence ao projeto.');
    return s;
  }
  private async attach(
    project: string,
    sourceId: string,
    fileId: string,
    rights: z.infer<typeof rightsSchema>,
    c: PoolClient,
  ) {
    await this.source(project, sourceId, c);
    const f = await this.files.requireAvailable(project, fileId, c);
    const declaration = {
      ...rights,
      verifiedAt: new Date().toISOString(),
      declarationNote:
        'Declaração do usuário; não constitui verificação independente de licença.',
    };
    await c.query(
      "UPDATE video_remix_sources SET imported_file_id=$3,duration_seconds=$4,status='IMPORTED',licensing=$5::jsonb WHERE project_id=$1 AND id=$2",
      [
        project,
        sourceId,
        fileId,
        f.duration_seconds,
        JSON.stringify(declaration),
      ],
    );
  }
  async attachFile(project: string, source: string, body: unknown) {
    const p = attachSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Informe arquivo, revisão e declaração/evidência de direitos.',
      );
    return this.repo.locked(
      project,
      this.projects.owner(),
      p.data.revision,
      async (pr, c) => {
        await this.attach(project, source, p.data.fileId, p.data.rights, c);
        await this.repo.save(pr, c);
        return this.projectsResult(project, c);
      },
    );
  }
  private async projectsResult(project: string, c: PoolClient) {
    return {
      project: await this.repo.get(project, this.projects.owner(), c),
      sources: await this.repo.sources(project, c),
    };
  }
  async upload(
    project: string,
    file: RemixUpload | undefined,
    body: unknown,
    signal?: AbortSignal,
  ) {
    if (!file) throw new BadRequestException('Envie um arquivo de vídeo.');
    let storedKey: string | undefined;
    let committed = false;
    try {
      await this.authorize(project);
      const fields = z
        .object({
          revision: z.coerce.number().int().nonnegative(),
          sourceId: z.string().uuid().optional(),
          rights: z.string().max(10000),
          title: z.string().trim().min(1).max(200).optional(),
        })
        .strict()
        .safeParse(body);
      if (!fields.success)
        throw new BadRequestException('Dados do upload inválidos.');
      let rights: z.infer<typeof rightsSchema>;
      try {
        rights = rightsSchema.parse(JSON.parse(fields.data.rights));
      } catch {
        throw new BadRequestException(
          'Confirme os direitos de uso e informe uma evidência ou referência.',
        );
      }
      const checkpoint = () => {
        if (signal?.aborted)
          throw new BadRequestException('Upload interrompido pelo cliente.');
      };
      checkpoint();
      const metadata = await this.validator.validate(file, signal);
      checkpoint();
      const id = randomUUID();
      storedKey = `remix/${project}/${id}.${metadata.extension}`;
      if (!this.files.storage.saveFile)
        throw new ServiceUnavailableException(
          'Storage não suporta importação.',
        );
      // A delayed durable cleanup record protects against a process crash between
      // creating the immutable file and committing its database record.
      await this.repo.db.query(
        "INSERT INTO video_remix_storage_cleanup(storage_key,not_before) VALUES($1,NOW()+INTERVAL '1 hour')",
        [storedKey],
      );
      try {
        await this.files.storage.saveFile(storedKey, file.path);
      } catch {
        throw new ServiceUnavailableException(
          'Não foi possível armazenar o vídeo. Tente novamente.',
        );
      }
      const result = await this.repo.locked(
        project,
        this.projects.owner(),
        fields.data.revision,
        async (pr, c) => {
          checkpoint();
          if (
            !fields.data.sourceId &&
            ((pr.mode === 'SINGLE_SOURCE' && pr.sourceCount) ||
              pr.sourceCount >= 100)
          )
            throw new ConflictException(
              'Escolha uma fonte existente para receber o arquivo ou remova a fonte atual.',
            );
          const name =
            basename(file.originalname.replace(/\\/g, '/'))
              .split('')
              .filter(
                (char) =>
                  char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
              )
              .join('')
              .slice(0, 200) || `video.${metadata.extension}`;
          await c.query(
            'INSERT INTO video_remix_files(id,project_id,storage_key,original_name,byte_size,extension,mime_type,duration_seconds,width,height,fps,codec) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
            [
              id,
              project,
              storedKey,
              name,
              file.size,
              metadata.extension,
              metadata.mimeType,
              metadata.durationSeconds,
              metadata.width,
              metadata.height,
              metadata.fps,
              metadata.codec,
            ],
          );
          let sourceId = fields.data.sourceId;
          if (!sourceId) {
            sourceId = randomUUID();
            await c.query(
              "INSERT INTO video_remix_sources(id,project_id,title,origin_type,status,licensing,platform) VALUES($1,$2,$3,'LOCAL_UPLOAD','UNAVAILABLE',$4::jsonb,'LOCAL')",
              [
                sourceId,
                project,
                fields.data.title ?? name,
                JSON.stringify({ authorization: 'UNKNOWN', notes: '' }),
              ],
            );
          }
          await this.attach(project, sourceId, id, rights, c);
          await this.repo.save(pr, c);
          await c.query(
            'DELETE FROM video_remix_storage_cleanup WHERE storage_key=$1',
            [storedKey],
          );
          checkpoint();
          return {
            ...(await this.projectsResult(project, c)),
            file: this.files.dto(await this.files.get(project, id, c)),
          };
        },
      );
      committed = true;
      return result;
    } finally {
      await unlink(file.path).catch(() => {});
      if (storedKey && !committed) {
        try {
          await this.files.storage.delete(storedKey);
          await this.repo.db.query(
            'DELETE FROM video_remix_storage_cleanup WHERE storage_key=$1',
            [storedKey],
          );
        } catch {
          /* durable cleanup retries after grace period */
        }
      }
    }
  }
  async unlinkFile(project: string, source: string, body: unknown) {
    const p = remixDeleteSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException('Confirme a desvinculação e a revisão.');
    return this.repo.locked(
      project,
      this.projects.owner(),
      p.data.revision,
      async (pr, c) => {
        const s = await this.source(project, source, c);
        await c.query(
          'UPDATE video_remix_sources SET imported_file_id=NULL,status=$3 WHERE project_id=$1 AND id=$2',
          [
            project,
            source,
            s.platform === 'YOUTUBE' ? 'SELECTED' : 'METADATA_ONLY',
          ],
        );
        await this.repo.save(pr, c);
        return this.projectsResult(project, c);
      },
    );
  }
  async deleteFile(project: string, fileId: string, body: unknown) {
    const p = remixDeleteSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Confirme a exclusão do arquivo e a revisão.',
      );
    const r = await this.repo.locked(
      project,
      this.projects.owner(),
      p.data.revision,
      async (pr, c) => {
        const f = await this.files.get(project, fileId, c);
        await c.query(
          "UPDATE video_remix_sources SET imported_file_id=NULL,status=CASE WHEN platform='YOUTUBE' THEN 'SELECTED' ELSE 'METADATA_ONLY' END WHERE project_id=$1 AND imported_file_id=$2",
          [project, fileId],
        );
        await c.query(
          'INSERT INTO video_remix_storage_cleanup(storage_key) VALUES($1) ON CONFLICT(storage_key) DO UPDATE SET not_before=NOW()',
          [f.storage_key],
        );
        await c.query(
          'DELETE FROM video_remix_files WHERE project_id=$1 AND id=$2',
          [project, fileId],
        );
        await this.repo.save(pr, c);
        return this.projectsResult(project, c);
      },
    );
    await this.files.clean();
    return r;
  }
  async rights(project: string, sourceId: string, body: unknown) {
    const p = z
      .object({
        revision: z.number().int().nonnegative(),
        rights: rightsSchema.nullable(),
      })
      .strict()
      .safeParse(body);
    if (!p.success)
      throw new BadRequestException('Declaração de direitos inválida.');
    return this.repo.locked(
      project,
      this.projects.owner(),
      p.data.revision,
      async (pr, c) => {
        const s = await this.source(project, sourceId, c);
        if (p.data.rights && s.importedFileId)
          await this.attach(
            project,
            sourceId,
            s.importedFileId,
            p.data.rights,
            c,
          );
        else
          await c.query(
            'UPDATE video_remix_sources SET licensing=$3::jsonb,status=$4 WHERE project_id=$1 AND id=$2',
            [
              project,
              sourceId,
              JSON.stringify(
                p.data.rights
                  ? { ...p.data.rights, verifiedAt: new Date().toISOString() }
                  : {
                      ...s.licensing,
                      userDeclaredRights: false,
                      verifiedAt: new Date().toISOString(),
                    },
              ),
              p.data.rights
                ? s.platform === 'YOUTUBE'
                  ? 'SELECTED'
                  : 'METADATA_ONLY'
                : 'UNAVAILABLE',
            ],
          );
        await this.repo.save(pr, c);
        return this.projectsResult(project, c);
      },
    );
  }
}
