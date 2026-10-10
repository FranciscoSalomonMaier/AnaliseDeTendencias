import type { ReadStream } from 'node:fs';
export abstract class StorageProvider {
  abstract stat?(key: string): Promise<{ size: number }>;
  abstract copyTo?(key: string, destination: string): Promise<void>;
  abstract saveFile?(key: string, source: string): Promise<void>;
  abstract openRead?(key: string, start?: number, end?: number): ReadStream;
  abstract save(key: string, data: Buffer): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract read(key: string): Promise<Buffer>;
  abstract getUrl(projectId: string, assetId: string): string;
}
