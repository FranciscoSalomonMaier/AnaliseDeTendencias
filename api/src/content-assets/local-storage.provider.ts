import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdir,
  open,
  readFile,
  unlink,
  stat,
  realpath,
} from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve, sep } from 'node:path';
import { StorageProvider } from './storage.provider';

@Injectable()
export class LocalStorageProvider extends StorageProvider {
  private readonly root: string;
  constructor(config: ConfigService) {
    super();
    this.root = resolve(
      config.get<string>('CONTENT_STORAGE_PATH') ?? 'storage',
    );
  }
  private path(key: string) {
    if (
      !/^[a-zA-Z0-9/-]+\.(png|jpg|webp|mp3|wav|aac|m4a|ogg|flac|mp4|mov|webm|mkv)$/.test(
        key,
      )
    )
      throw new Error('Storage key inválida');
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep))
      throw new Error('Storage key fora da raiz');
    return path;
  }
  async save(key: string, image: Buffer) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    // Exclusive creation: every variation has its own immutable asset ID.
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(image);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    } finally {
      await file.close();
    }
  }
  async delete(key: string) {
    await unlink(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  async read(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      throw new NotFoundException('Arquivo indisponível');
    }
  }
  async stat(key: string) {
    const info = await stat(this.path(key));
    if (!info.isFile()) throw new NotFoundException('Arquivo indisponível');
    return { size: info.size };
  }
  async copyTo(key: string, destination: string) {
    // Authorization must survive staging into an executor workspace: never copy a
    // storage symlink to an external file and thereby turn it into a trusted source.
    const [root, path] = await Promise.all([
      realpath(this.root),
      realpath(this.path(key)),
    ]);
    if (!path.startsWith(root + sep))
      throw new NotFoundException('Arquivo fora do armazenamento autorizado');
    const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let target: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const before = await source.stat();
      if (!before.isFile()) throw new NotFoundException('Arquivo indisponível');
      target = await open(destination, 'wx', 0o600);
      await pipeline(source.createReadStream(), target.createWriteStream());
      const after = await stat(path);
      if (
        before.ino !== after.ino ||
        before.dev !== after.dev ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        (await realpath(this.path(key))) !== path
      )
        throw new NotFoundException('Arquivo alterado durante a cópia');
    } catch (e) {
      if (target) await unlink(destination).catch(() => {});
      throw e;
    } finally {
      await target?.close();
      await source.close();
    }
  }
  async saveFile(key: string, source: string) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, 'wx', 0o600);
    try {
      await pipeline(createReadStream(source), file.createWriteStream());
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    } finally {
      await file.close();
    }
  }
  openRead(key: string, start?: number, end?: number) {
    return createReadStream(this.path(key), { start, end });
  }
  getUrl(projectId: string, assetId: string) {
    return `/content-projects/${projectId}/assets/${assetId}/file`;
  }
}
