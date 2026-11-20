import { shortClassificationCatalogs } from './classification/short-classification.catalog';
import { defaultShortMusic } from './short-music.schema';
import {
  activeEditing,
  editingFeatures,
  featureSelection,
} from './short-editing.schema';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { StorageProvider } from '../content-assets/storage.provider';
import { RemixVideoValidator } from '../video-remix/remix-video.validator';
import type { RemixUpload } from '../video-remix/remix-import.settings';
import { TTS_VOICES } from '../content-narration/tts-settings';
import { ShortSettings } from './short.settings';
import {
  createShortSchema,
  patchShortSchema,
  jobShortSchema,
  shortStepAllowed,
  type ShortProject,
  type ShortFile,
  type ShortData,
} from './short.schema';
@Injectable()
export class ShortService {
  constructor(
    readonly db: PostgresDatabaseService,
    readonly settings: ShortSettings,
    readonly storage: StorageProvider,
    readonly validator: RemixVideoValidator,
  ) {}
  async project(
    id: string,
    db: {
      query<T extends QueryResultRow>(
        sql: string,
        values?: unknown[],
      ): Promise<QueryResult<T>>;
    } = this.db,
    lock = false,
  ) {
    const r = await db.query<ShortProject>(
      `SELECT * FROM short_projects WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [id, this.settings.owner],
    );
    if (!r.rows[0]) throw new NotFoundException('Short não encontrado.');
    return r.rows[0];
  }
  async files(
    id: string,
    db: {
      query<T extends QueryResultRow>(
        sql: string,
        values?: unknown[],
      ): Promise<QueryResult<T>>;
    } = this.db,
    role: 'SOURCE' | 'REFERENCE' = 'SOURCE',
  ) {
    return (
      await db.query<ShortFile>(
        'SELECT * FROM short_files WHERE project_id=$1 AND role=$2 ORDER BY created_at,id',
        [id, role],
      )
    ).rows;
  }
  async get(id: string) {
    const p = await this.project(id);
    const files = await this.files(id);
    const references = await this.files(id, this.db, 'REFERENCE');
    const job =
      (
        await this.db.query(
          'SELECT id,kind,status,progress,error_message,created_at,usage FROM short_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1',
          [id],
        )
      ).rows[0] ?? null;
    const { audio, output, music, ...data } = p.data;
    return {
      ...p,
      owner_id: undefined,
      data: {
        ...data,
        music: music
          ? { ...music, key: undefined, url: `/shorts/${id}/music` }
          : null,
        musicSettings: data.musicSettings ?? defaultShortMusic(),
        audio: audio
          ? { ...audio, key: undefined, url: `/shorts/${id}/audio` }
          : null,
        output: output
          ? {
              ...output,
              key: undefined,
              url: `/shorts/${id}/video`,
              downloadUrl: `/shorts/${id}/video?download=1`,
            }
          : null,
      },
      files: files.map(({ storage_key, ...f }) => ({
        ...f,
        bytes: Number(f.bytes),
        url: `/shorts/${id}/files/${f.id}`,
      })),
      references: references.map(({ storage_key, ...f }) => ({
        ...f,
        bytes: Number(f.bytes),
        url: `/shorts/${id}/references/${f.id}`,
      })),
      job,
    };
  }
  async list() {
    return {
      items: (
        await this.db.query(
          "SELECT id,title,step,status,created_at,updated_at,data->'output'->>'duration' AS duration FROM short_projects WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 100",
          [this.settings.owner],
        )
      ).rows,
    };
  }
  options() {
    return {
      aiEnabled: this.settings.enabled,
      classifications: shortClassificationCatalogs,
      voices: TTS_VOICES,
      maxBytes: this.settings.maxBytes,
      musicMaxBytes: this.settings.musicMaxBytes,
      musicMaxSeconds: this.settings.musicMaxSeconds,
      maxFiles: this.settings.maxFiles,
      maxDuration: this.settings.maxDuration,
      scanSeconds: this.settings.scanSeconds,
      referenceMaxFiles: this.settings.referenceFiles,
      referenceMaxSeconds: this.settings.referenceSeconds,
      referenceMaxFrames: this.settings.referenceFrames,
      editingFeatures,
    };
  }
  async create(raw: unknown) {
    const v = createShortSchema.safeParse(raw);
    if (!v.success)
      throw new BadRequestException(
        'Descreva o Short e escolha 30, 45 ou 60 segundos.',
      );
    const id = randomUUID();
    await this.db.query(
      'INSERT INTO short_projects(id,owner_id,title,description,target_seconds,data) VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        this.settings.owner,
        v.data.description.slice(0, 90),
        v.data.description,
        v.data.targetSeconds,
        v.data.classification ? { classification: v.data.classification } : {},
      ],
    );
    return this.get(id);
  }
  async locked<T>(
    id: string,
    fn: (p: ShortProject, c: PoolClient) => Promise<T>,
  ) {
    return this.db.withClient(async (c) => {
      await c.query('BEGIN');
      try {
        const p = await this.project(id, c, true);
        if (['QUEUED', 'RUNNING'].includes(p.status))
          throw new ConflictException('Aguarde o processamento atual.');
        const result = await fn(p, c);
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
  }
  checkRevision(p: ShortProject, revision: number) {
    if (p.revision !== revision)
      throw new ConflictException(
        'O projeto mudou. Atualize a página antes de salvar.',
      );
  }
  async cleanupData(c: PoolClient, old: ShortData, next: ShortData) {
    for (const key of [old.audio?.key, old.output?.key, old.music?.key])
      if (
        key &&
        key !== next.audio?.key &&
        key !== next.output?.key &&
        key !== next.music?.key
      )
        await c.query(
          'INSERT INTO short_storage_cleanup(storage_key) VALUES($1) ON CONFLICT DO NOTHING',
          [key],
        );
  }
  async patch(id: string, raw: unknown) {
    const v = patchShortSchema.safeParse(raw);
    if (!v.success) throw new BadRequestException('Revise os campos do Short.');
    const input = v.data;
    await this.locked(id, async (p, c) => {
      this.checkRevision(p, input.revision);
      const data = { ...p.data };
      let step = p.step;
      // Editorial metadata only: no invalidation, inference or automatic execution.
      if (input.classification !== undefined)
        data.classification = input.classification;
      if (
        input.classification !== undefined &&
        Object.keys(input).every((key) =>
          ['revision', 'classification'].includes(key),
        )
      ) {
        await c.query(
          'UPDATE short_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1',
          [id, data],
        );
        return;
      }

      if (
        input.script &&
        JSON.stringify(input.script) !== JSON.stringify(data.script)
      ) {
        data.script = input.script;
        data.scriptApproved = false;
        delete data.narrationText;
        data.textApproved = false;
        delete data.audio;
        delete data.plan;
        delete data.decorations;
        data.planApproved = false;
        delete data.output;
        step = 1;
      }
      if (
        input.narrationText !== undefined &&
        input.narrationText !== data.narrationText
      ) {
        if (!data.scriptApproved)
          throw new BadRequestException('Aprove o roteiro primeiro.');
        data.narrationText = input.narrationText;
        data.textApproved = false;
        delete data.audio;
        delete data.plan;
        delete data.decorations;
        data.planApproved = false;
        delete data.output;
        step = 4;
      }
      if (input.voice && input.voice !== data.voice) {
        data.voice = input.voice;
        delete data.audio;
        delete data.plan;
        delete data.decorations;
        data.planApproved = false;
        delete data.output;
        step = Math.min(step, 5);
      }
      if (input.framing && input.framing !== data.framing) {
        data.framing = input.framing;
        delete data.output;
      }
      if (
        input.referenceFeatures !== undefined ||
        input.editingConfig !== undefined ||
        input.skipReferences
      ) {
        if (!data.scriptApproved)
          throw new BadRequestException('Aprove o roteiro primeiro.');
        if (input.skipReferences)
          data.editing = {
            ...(data.editing ?? { features: [...editingFeatures] }),
            enabled: false,
            approved: false,
          };
        if (
          input.referenceFeatures !== undefined &&
          JSON.stringify(input.referenceFeatures) !==
            JSON.stringify(data.editing?.features)
        )
          data.editing = {
            enabled: false,
            features: input.referenceFeatures,
            approved: false,
          };
        if (input.editingConfig) {
          if (!data.editing?.profiles?.length)
            throw new BadRequestException(
              'Analise as referências antes de ajustar a edição.',
            );
          data.editing = {
            ...data.editing,
            config: input.editingConfig,
            enabled: true,
            approved: false,
          };
        }
        if (!input.skipReferences) step = 3;
        if (input.skipReferences) step = 4;
      }
      if (input.approve === 'EDITING') {
        if (!data.editing?.config || !data.editing.profiles?.length)
          throw new BadRequestException(
            'Analise e revise as referências ou pule esta etapa.',
          );
        data.editing = { ...data.editing, enabled: true, approved: true };
        step = 4;
      }
      if (
        JSON.stringify(activeEditing(p.data)) !==
        JSON.stringify(activeEditing(data))
      ) {
        delete data.narrationText;
        data.textApproved = false;
        delete data.audio;
        delete data.plan;
        delete data.decorations;
        data.planApproved = false;
        delete data.output;
      }
      if (input.approve === 'SCRIPT') {
        if (!data.script)
          throw new BadRequestException('Gere ou escreva o roteiro.');
        data.scriptApproved = true;
        step = 2;
      }
      if (input.approve === 'TEXT') {
        if (!data.scriptApproved || !data.narrationText)
          throw new BadRequestException('Crie o texto da narração.');
        data.textApproved = true;
        step = 5;
      }
      if (input.approve === 'PLAN') {
        if (!data.audio || !data.plan?.clips.length)
          throw new BadRequestException('Selecione os trechos primeiro.');
        data.planApproved = true;
        step = 7;
      }
      if (
        input.musicSettings !== undefined ||
        input.musicEnabled !== undefined ||
        input.removeMusic ||
        input.skipMusic
      ) {
        if (p.step !== 7 || !data.audio || !data.planApproved)
          throw new BadRequestException(
            'Abra Trilha sonora após aprovar a montagem.',
          );
        const audibleMix = (value: ShortData) =>
          value.music &&
          value.musicEnabled !== false &&
          (value.musicSettings?.volume ?? 0.15) > 0
            ? [value.music, value.musicSettings ?? defaultShortMusic()]
            : null;
        const previous = JSON.stringify(audibleMix(data));
        if (input.musicSettings) data.musicSettings = input.musicSettings;
        if (input.musicEnabled !== undefined)
          data.musicEnabled = input.musicEnabled;
        if (input.removeMusic) delete data.music;
        if (input.skipMusic) data.musicEnabled = false;
        if (previous !== JSON.stringify(audibleMix(data))) delete data.output;
      }
      if (input.step !== undefined) step = input.step;
      if (!shortStepAllowed({ ...p, data }, await this.files(id, c), step))
        throw new BadRequestException(
          'Conclua e aprove a etapa anterior antes de continuar.',
        );
      await this.cleanupData(c, p.data, data);
      await c.query(
        'UPDATE short_projects SET data=$2,step=$3,revision=revision+1,status=$4,error_message=NULL,updated_at=NOW() WHERE id=$1',
        [id, data, step, data.output ? 'COMPLETED' : 'DRAFT'],
      );
    });
    return this.get(id);
  }
  async upload(
    id: string,
    file: RemixUpload | undefined,
    rights: unknown,
    role: 'SOURCE' | 'REFERENCE' = 'SOURCE',
  ) {
    if (!file) throw new BadRequestException('Selecione um vídeo.');
    let key: string | undefined;
    try {
      if (rights !== 'true')
        throw new BadRequestException(
          'Confirme sua autorização para usar os vídeos.',
        );
      if (
        !['.mp4', '.mov', '.webm'].includes(
          extname(file.originalname).toLowerCase(),
        ) ||
        file.size > this.settings.maxBytes
      )
        throw new BadRequestException(
          'Envie MP4, MOV ou WebM dentro do limite de tamanho.',
        );
      const meta = await this.validator.validate(file);
      if (
        meta.durationSeconds >
          (role === 'REFERENCE'
            ? this.settings.referenceSeconds
            : this.settings.maxDuration) ||
        meta.width * meta.height > 3840 * 2160
      )
        throw new BadRequestException(
          'Vídeo acima do limite de duração ou de resolução (4K).',
        );
      const fileId = randomUUID();
      key = `shorts/${id}/${role === 'REFERENCE' ? 'references' : 'sources'}/${fileId}.${meta.extension}`;
      await this.db.query(
        'INSERT INTO short_storage_cleanup(storage_key) VALUES($1)',
        [key],
      );
      await this.locked(id, async (p, c) => {
        if (!p.data.scriptApproved || p.step !== (role === 'REFERENCE' ? 3 : 2))
          throw new BadRequestException(
            'Aprove o roteiro e abra a etapa Enviar vídeos.',
          );
        const files = await this.files(id, c, role);
        if (
          files.length >=
          (role === 'REFERENCE'
            ? this.settings.referenceFiles
            : this.settings.maxFiles)
        )
          throw new BadRequestException('Limite de vídeos atingido.');
        if (!this.storage.saveFile)
          throw new ServiceUnavailableException('Storage incompatível.');
        await this.storage.saveFile(key!, file.path);
        await c.query(
          'INSERT INTO short_files(id,project_id,original_name,storage_key,bytes,duration,width,height,fps,mime,role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            fileId,
            id,
            file.originalname.replace(/[\x00-\x1f]/g, '').slice(0, 250),
            key,
            file.size,
            meta.durationSeconds,
            meta.width,
            meta.height,
            meta.fps,
            meta.mimeType,
            role,
          ],
        );
        await c.query(
          'DELETE FROM short_storage_cleanup WHERE storage_key=$1',
          [key],
        );
        const data = { ...p.data };
        if (role === 'REFERENCE') {
          data.editing = {
            enabled: false,
            features: data.editing?.features ?? [...editingFeatures],
            approved: false,
          };
          delete data.narrationText;
          data.textApproved = false;
          delete data.audio;
        }
        delete data.plan;
        delete data.decorations;
        data.planApproved = false;
        delete data.output;
        await this.cleanupData(c, p.data, data);
        await c.query(
          "UPDATE short_projects SET data=$2,revision=revision+1,status='DRAFT',updated_at=NOW() WHERE id=$1",
          [id, data],
        );
      });
      return await this.get(id);
    } catch (e) {
      if (key) await this.storage.delete(key).catch(() => {});
      throw e;
    } finally {
      await unlink(file.path).catch(() => {});
    }
  }
  async removeFile(
    id: string,
    fileId: string,
    role: 'SOURCE' | 'REFERENCE' = 'SOURCE',
  ) {
    await this.locked(id, async (p, c) => {
      if (p.step !== (role === 'REFERENCE' ? 3 : 2))
        throw new BadRequestException(
          'Volte à etapa de envio para remover vídeos.',
        );
      const f = (await this.files(id, c, role)).find((f) => f.id === fileId);
      if (!f) throw new NotFoundException('Vídeo não encontrado.');
      await c.query(
        'INSERT INTO short_storage_cleanup(storage_key) VALUES($1) ON CONFLICT DO NOTHING',
        [f.storage_key],
      );
      await c.query('DELETE FROM short_files WHERE id=$1 AND project_id=$2', [
        fileId,
        id,
      ]);
      const data = { ...p.data };
      if (role === 'REFERENCE') {
        data.editing = {
          enabled: false,
          features: data.editing?.features ?? [...editingFeatures],
          approved: false,
        };
        delete data.narrationText;
        data.textApproved = false;
        delete data.audio;
      }
      delete data.plan;
      delete data.decorations;
      data.planApproved = false;
      delete data.output;
      await this.cleanupData(c, p.data, data);
      await c.query(
        "UPDATE short_projects SET data=$2,revision=revision+1,status='DRAFT',updated_at=NOW() WHERE id=$1",
        [id, data],
      );
    });
    return this.get(id);
  }
  async enqueue(id: string, raw: unknown) {
    const v = jobShortSchema.safeParse(raw);
    if (!v.success)
      throw new BadRequestException('Confirme a operação e atualize a página.');
    const input = v.data;
    await this.locked(id, async (p, c) => {
      this.checkRevision(p, input.revision);
      const files = await this.files(id, c);
      const d = p.data;
      const references = await this.files(id, c, 'REFERENCE');
      if (
        input.kind === 'REFERENCES' &&
        (!d.scriptApproved ||
          p.step !== 3 ||
          !references.length ||
          !(d.editing?.features ?? editingFeatures).length)
      )
        throw new BadRequestException(
          'Envie referências na etapa Referências de Edição.',
        );
      if (
        ['SCRIPT', 'REFERENCES', 'TEXT'].includes(input.kind) &&
        !this.settings.enabled
      )
        throw new ServiceUnavailableException(
          'Configure a chave e o modelo de IA no servidor.',
        );
      if (input.kind === 'TEXT' && (!d.scriptApproved || !files.length))
        throw new BadRequestException(
          'Aprove o roteiro e envie os vídeos primeiro.',
        );
      if (
        input.kind === 'AUDIO' &&
        (!d.textApproved || !d.narrationText || !files.length)
      )
        throw new BadRequestException('Aprove o texto da narração primeiro.');
      if (input.kind === 'PLAN' && (!d.audio || !files.length))
        throw new BadRequestException(
          'Gere a narração e envie vídeos primeiro.',
        );
      if (input.kind === 'PLAN' && input.semantic && !this.settings.enabled)
        throw new ServiceUnavailableException(
          'Análise visual indisponível. Use a montagem básica.',
        );
      if (
        input.kind === 'RENDER' &&
        (!d.audio || !d.planApproved || !d.plan?.clips.length)
      )
        throw new BadRequestException('Aprove o plano de cortes primeiro.');
      if (
        Number(
          (
            await c.query(
              'SELECT count(*)::int n FROM short_jobs WHERE project_id=$1',
              [id],
            )
          ).rows[0].n,
        ) >= 100
      )
        throw new BadRequestException(
          'Limite de 100 operações por projeto atingido.',
        );
      if (
        Number(
          (
            await c.query(
              "SELECT count(*)::int n FROM short_jobs WHERE status IN ('QUEUED','RUNNING')",
            )
          ).rows[0].n,
        ) >= 20
      )
        throw new ServiceUnavailableException('Fila cheia. Tente mais tarde.');
      await c.query(
        'INSERT INTO short_jobs(id,project_id,kind,input) VALUES($1,$2,$3,$4)',
        [
          randomUUID(),
          id,
          input.kind,
          { project: p, files, references, semantic: input.semantic },
        ],
      );
      await c.query(
        "UPDATE short_projects SET status='QUEUED',error_message=NULL,updated_at=NOW() WHERE id=$1",
        [id],
      );
    });
    return this.get(id);
  }
  async remove(id: string) {
    await this.locked(id, async (p, c) => {
      const keys = [
        ...(await this.files(id, c))
          .concat(await this.files(id, c, 'REFERENCE'))
          .map((f) => f.storage_key),
        p.data.audio?.key,
        p.data.output?.key,
        p.data.music?.key,
      ].filter(Boolean);
      for (const key of keys)
        await c.query(
          'INSERT INTO short_storage_cleanup(storage_key) VALUES($1) ON CONFLICT DO NOTHING',
          [key],
        );
      await c.query('DELETE FROM short_projects WHERE id=$1 AND owner_id=$2', [
        id,
        this.settings.owner,
      ]);
    });
    return { deleted: true };
  }
  async media(
    id: string,
    type: 'audio' | 'video' | 'source' | 'reference' | 'music',
    fileId?: string,
  ) {
    const p = await this.project(id);
    const f =
      type === 'source' || type === 'reference'
        ? (
            await this.files(
              id,
              this.db,
              type === 'reference' ? 'REFERENCE' : 'SOURCE',
            )
          ).find((f) => f.id === fileId)
        : null;
    const asset =
      type === 'source' || type === 'reference'
        ? f
          ? { key: f.storage_key, bytes: Number(f.bytes), mime: f.mime }
          : null
        : type === 'music'
          ? p.data.music
          : type === 'audio'
            ? p.data.audio
            : p.data.output
              ? { ...p.data.output, mime: 'video/mp4' }
              : null;
    if (!asset || !this.storage.stat || !this.storage.openRead)
      throw new NotFoundException('Arquivo indisponível.');
    const stat = await this.storage.stat(asset.key);
    if (stat.size !== asset.bytes)
      throw new NotFoundException('Arquivo ausente ou alterado.');
    return {
      ...asset,
      open: (start?: number, end?: number) =>
        this.storage.openRead!(asset.key, start, end),
    };
  }
}
