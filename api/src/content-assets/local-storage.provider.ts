import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
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
    if (!/^[a-zA-Z0-9/-]+\.(png|jpg|webp|mp3|wav)$/.test(key))
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
  getUrl(projectId: string, assetId: string) {
    return `/content-projects/${projectId}/assets/${assetId}/file`;
  }
}
