jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { mkdtemp, mkdir, symlink, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalStorageProvider } from '../content-assets/local-storage.provider';
describe('Intelligent staging storage authorization', () => {
  let dir: string, storage: LocalStorageProvider;
  beforeEach(async () => {
    dir = await mkdtemp('/tmp/short-storage-');
    storage = new LocalStorageProvider({
      get: () => join(dir, 'store'),
    } as never);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  test('copies authorized files privately and refuses overwrite', async () => {
    await storage.save('allowed/file.mp4', Buffer.from('test'));
    const copy = join(dir, 'copy.mp4');
    await storage.copyTo('allowed/file.mp4', copy);
    expect(await readFile(copy, 'utf8')).toBe('test');
    expect((await stat(copy)).mode & 0o777).toBe(0o600);
    await expect(storage.copyTo('allowed/file.mp4', copy)).rejects.toThrow();
  });
  test('rejects a storage symlink escaping its root before staging', async () => {
    await storage.save('allowed/file.mp4', Buffer.from('inside'));
    const outside = new LocalStorageProvider({
      get: () => join(dir, 'outside'),
    } as never);
    await outside.save('private.mp4', Buffer.from('outside'));
    await symlink(
      join(dir, 'outside/private.mp4'),
      join(dir, 'store/allowed/link.mp4'),
    );
    await expect(
      storage.copyTo('allowed/link.mp4', join(dir, 'copy.mp4')),
    ).rejects.toThrow('autorizado');
    await expect(stat(join(dir, 'copy.mp4'))).rejects.toThrow();
  });
  test('rejects a parent-directory symlink escaping storage', async () => {
    await mkdir(join(dir, 'store'));
    const outside = new LocalStorageProvider({
      get: () => join(dir, 'outside'),
    } as never);
    await outside.save('private.mp4', Buffer.from('outside'));
    await symlink(join(dir, 'outside'), join(dir, 'store/alias'));
    await expect(
      storage.copyTo('alias/private.mp4', join(dir, 'copy.mp4')),
    ).rejects.toThrow('autorizado');
  });
});
