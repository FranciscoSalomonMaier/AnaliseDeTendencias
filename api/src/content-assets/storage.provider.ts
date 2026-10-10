export abstract class StorageProvider {
  abstract save(key: string, data: Buffer): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract read(key: string): Promise<Buffer>;
  abstract getUrl(projectId: string, assetId: string): string;
}
