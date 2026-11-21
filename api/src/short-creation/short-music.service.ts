import {
  resolveNarrationMode,
  UNNARRATED_RENDER_MESSAGE,
} from './short-narration.schema';
import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { basename, extname, join } from 'node:path';
import { open, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ShortSettings } from './short.settings';
import { ShortService } from './short.service';
import { MediaProcess } from '../video-render/media-process';
import { RenderSettings } from '../video-render/render-settings';
import { AudioMixService } from '../content-audio/audio-mix.service';
import { StorageProvider } from '../content-assets/storage.provider';
import type { RemixUpload } from '../video-remix/remix-import.settings';
import type { ShortData } from './short.schema';
import {
  musicFormats,
  defaultShortMusic,
  shortMusicSettingsSchema,
} from './short-music.schema';
@Injectable()
export class ShortMusicValidator {
  constructor(
    readonly settings: ShortSettings,
    readonly process: MediaProcess,
    readonly renders: RenderSettings,
  ) {}
  async validate(file: RemixUpload) {
    const ext = extname(file.originalname).slice(1).toLowerCase(),
      format = musicFormats[ext];
    if (
      !format ||
      !file.size ||
      file.size > this.settings.musicMaxBytes ||
      (await stat(file.path)).size !== file.size
    )
      throw new BadRequestException(
        'Envie MP3, WAV, AAC, M4A, OGG ou FLAC dentro do limite de tamanho.',
      );
    if (
      ![...format.accepted, 'application/octet-stream'].includes(file.mimetype)
    )
      throw new BadRequestException(
        'Tipo de áudio incompatível com a extensão.',
      );
    const handle = await open(file.path, 'r');
    const head = Buffer.alloc(16);
    try {
      await handle.read(head, 0, 16, 0);
    } finally {
      await handle.close();
    }
    const magic =
      ext === 'wav'
        ? head.toString('ascii', 0, 4) === 'RIFF' &&
          head.toString('ascii', 8, 12) === 'WAVE'
        : ext === 'mp3'
          ? head.toString('ascii', 0, 3) === 'ID3' ||
            (head[0] === 255 && (head[1] & 0xe0) === 0xe0)
          : ext === 'aac'
            ? head[0] === 255 && (head[1] & 0xf6) === 0xf0
            : ext === 'm4a'
              ? head.toString('ascii', 4, 8) === 'ftyp'
              : ext === 'ogg'
                ? head.toString('ascii', 0, 4) === 'OggS'
                : head.toString('ascii', 0, 4) === 'fLaC';
    if (!magic)
      throw new BadRequestException(
        'O conteúdo real não corresponde ao formato do áudio.',
      );
    try {
      const probe = z
        .object({
          format: z.object({ duration: z.string(), format_name: z.string() }),
          streams: z.array(
            z.object({
              codec_type: z.string(),
              codec_name: z.string().optional(),
              sample_rate: z.string().optional(),
              channels: z.number().optional(),
              disposition: z
                .object({ attached_pic: z.number().optional() })
                .optional(),
            }),
          ),
        })
        .parse(
          JSON.parse(
            await this.process.run(
              this.renders.ffprobePath,
              [
                '-v',
                'error',
                '-protocol_whitelist',
                'file,pipe',
                '-show_format',
                '-show_streams',
                '-of',
                'json',
                file.path,
              ],
              30000,
            ),
          ),
        );
      const audio = probe.streams.filter((s) => s.codec_type === 'audio'),
        s = audio[0],
        duration = Number(probe.format.duration);
      if (
        audio.length !== 1 ||
        probe.streams.some(
          (s) => s.codec_type === 'video' && !s.disposition?.attached_pic,
        ) ||
        !probe.format.format_name.split(',').includes(format.format) ||
        !s?.codec_name ||
        !format.codecs.some((c) => s.codec_name!.startsWith(c)) ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > this.settings.musicMaxSeconds ||
        !s.channels ||
        s.channels > 8 ||
        !Number(s.sample_rate)
      )
        throw Error('Invalid audio');
      // Decode the whole selected track: successful probing alone does not ensure integrity.
      let decodedSeconds = 0;
      await this.process.run(
        this.renders.ffmpegPath,
        [
          '-hide_banner',
          '-v',
          'error',
          '-nostdin',
          '-xerror',
          '-err_detect',
          'explode',
          '-threads',
          '1',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          file.path,
          '-map',
          '0:a:0',
          '-af',
          'asetpts=N/SR/TB',
          '-t',
          String(this.settings.musicMaxSeconds + 1),
          '-progress',
          'pipe:1',
          '-nostats',
          '-vn',
          '-sn',
          '-dn',
          '-f',
          'null',
          '-',
        ],
        120000,
        undefined,
        (seconds) => {
          decodedSeconds = seconds;
        },
      );
      if (
        !Number.isFinite(decodedSeconds) ||
        decodedSeconds <= 0 ||
        decodedSeconds > this.settings.musicMaxSeconds
      )
        throw Error('Invalid decoded duration');
      return {
        duration: decodedSeconds,
        mime: format.mime,
        codec: s.codec_name,
        sampleRate: Number(s.sample_rate),
        channels: s.channels,
        extension: ext,
      };
    } catch {
      throw new BadRequestException(
        'Não foi possível validar o áudio. Confira a integridade, a faixa de áudio e o limite de duração.',
      );
    }
  }
}
@Injectable()
export class ShortSoundtrackService {
  constructor(
    readonly shorts: ShortService,
    readonly validator: ShortMusicValidator,
  ) {}
  async upload(id: string, file: RemixUpload | undefined, body: unknown) {
    if (!file) throw new BadRequestException('Selecione uma música.');
    let key: string | undefined;
    let committed = false;
    try {
      const parsed = z
        .object({
          rights: z.literal('true'),
          revision: z.coerce.number().int().nonnegative(),
        })
        .strict()
        .safeParse(body);
      if (!parsed.success)
        throw new BadRequestException(
          'Confirme a autorização de uso e a revisão do projeto.',
        );
      await this.shorts.project(id);
      const checked = await this.validator.validate(file),
        musicId = randomUUID();
      key = `shorts/${id}/music/${musicId}.${checked.extension}`;
      await this.shorts.db.query(
        'INSERT INTO short_storage_cleanup(storage_key) VALUES($1)',
        [key],
      );
      await this.shorts.locked(id, async (p, c) => {
        this.shorts.checkRevision(p, parsed.data.revision);
        if (resolveNarrationMode(p.data) === 'WITHOUT_NARRATION')
          throw new BadRequestException(UNNARRATED_RENDER_MESSAGE);
        if (p.step !== 7 || !p.data.audio || !p.data.planApproved)
          throw new BadRequestException(
            'Abra Trilha sonora após aprovar a montagem.',
          );
        if (!this.shorts.storage.saveFile)
          throw new ServiceUnavailableException('Storage incompatível.');
        await this.shorts.storage.saveFile(key!, file.path);
        const data: ShortData = {
          ...p.data,
          music: {
            id: musicId,
            key: key!,
            originalName: basename(file.originalname.replaceAll('\\', '/'))
              .replace(/[\x00-\x1f]/g, '')
              .slice(0, 250),
            bytes: file.size,
            duration: checked.duration,
            mime: checked.mime,
            codec: checked.codec,
            sampleRate: checked.sampleRate,
            channels: checked.channels,
            rightsDeclaredAt: new Date().toISOString(),
          },
          musicSettings: p.data.musicSettings ?? defaultShortMusic(),
          musicEnabled: true,
          output: undefined,
        };
        await this.shorts.cleanupData(c, p.data, data);
        await c.query(
          "UPDATE short_projects SET data=$2,revision=revision+1,status='DRAFT',error_message=NULL,updated_at=NOW() WHERE id=$1",
          [id, data],
        );
        await c.query(
          'DELETE FROM short_storage_cleanup WHERE storage_key=$1',
          [key],
        );
      });
      committed = true;
      return await this.shorts.get(id);
    } catch (error) {
      if (key && !committed)
        await this.shorts.storage.delete(key).catch(() => {});
      throw error;
    } finally {
      await unlink(file.path).catch(() => {});
    }
  }
  async remove(id: string, revision: number) {
    return this.shorts.patch(id, { revision, removeMusic: true });
  }
}
@Injectable()
export class ShortMusicRenderer {
  constructor(
    readonly mixer: AudioMixService,
    readonly process: MediaProcess,
    readonly renders: RenderSettings,
    readonly storage: StorageProvider,
  ) {}
  async prepare(
    data: ShortData,
    narration: string,
    dir: string,
    signal: AbortSignal,
  ) {
    if (resolveNarrationMode(data) === 'WITHOUT_NARRATION')
      throw Error(UNNARRATED_RENDER_MESSAGE);
    const music = data.music,
      settings = shortMusicSettingsSchema.parse(data.musicSettings ?? {}),
      total = data.audio!.duration;
    if (!music || data.musicEnabled === false || settings.volume === 0)
      return narration;
    if (!this.storage.copyTo || !this.storage.stat)
      throw Error('Storage incompatível.');
    if ((await this.storage.stat(music.key)).size !== music.bytes)
      throw new BadRequestException(
        'Arquivo da música ausente ou alterado. Envie-o novamente.',
      );
    const path = join(dir, 'music.' + music.key.split('.').at(-1));
    await this.storage.copyTo(music.key, path);
    const mix = this.mixer.build(
      {
        settings: {
          backgroundMusicAssetId: music.id,
          musicVolume: settings.volume,
          loopMusic: settings.loop && music.duration < total,
          musicFadeInSeconds: settings.fadeIn
            ? Math.min(
                settings.fadeInSeconds,
                total,
                settings.loop ? total : music.duration,
              )
            : 0,
          musicFadeOutSeconds: settings.fadeOut
            ? Math.min(
                settings.fadeOutSeconds,
                total,
                settings.loop ? total : music.duration,
              )
            : 0,
          duckingEnabled: settings.ducking,
          effects: [],
        },
        music: {
          assetId: music.id,
          storageKey: music.key,
          durationSeconds: music.duration,
          mimeType: music.mime,
          originalName: music.originalName,
          license: 'Declaração do usuário',
          origin: 'Upload',
          notes: '',
        },
        effects: [],
      },
      total,
      [{ assetId: music.id, path }],
    );
    const output = join(dir, 'mixed.wav');
    await this.process.run(
      this.renders.ffmpegPath,
      [
        '-hide_banner',
        '-v',
        'error',
        '-nostdin',
        '-threads',
        '1',
        '-filter_complex_threads',
        '1',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        narration,
        ...mix.inputArgs,
        '-filter_complex',
        mix.filters!,
        '-map',
        mix.map,
        '-c:a',
        'pcm_s16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-t',
        String(total),
        '-y',
        output,
      ],
      120000,
      signal,
    );
    const probe = JSON.parse(
      await this.process.run(
        this.renders.ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'json',
          output,
        ],
        30000,
        signal,
      ),
    );
    if (
      Math.abs(Number(probe.format?.duration) - total) > 0.025 ||
      !Number.isFinite(Number(probe.format?.duration))
    )
      throw new BadRequestException(
        'A mixagem não atingiu a duração completa do vídeo.',
      );
    return output;
  }
}
