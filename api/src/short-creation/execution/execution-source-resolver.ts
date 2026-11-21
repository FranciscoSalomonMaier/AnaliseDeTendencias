import { constants, createReadStream, createWriteStream } from 'node:fs';
import { access, open, realpath, stat, statfs } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { assetIdSchema } from '../resources/editing-resource.schema';
import { ExecutionFailure, type ExecutionAuthority } from './execution.schema';
/** Internal resolver. Paths are never taken from the plan. Snapshot copies prevent
 * the legacy validator's chmod and subsequent rendering from modifying originals. */
export async function snapshotSource(
  id: string,
  root: string,
  workspace: string,
  authority: ExecutionAuthority,
  signal: AbortSignal,
  kind: 'VIDEO' | 'AUDIO' | 'IMAGE',
) {
  assetIdSchema.parse(id);
  if (!authority.authorizedAssetIds.has(id))
    throw new ExecutionFailure('SOURCE_UNAUTHORIZED', 'Fonte não autorizada.');
  const location = await resolveAbortable(() => authority.resolve(id), signal);
  const canonicalRoot = await realpath(root),
    canonical = await realpath(location);
  const inside = relative(canonicalRoot, canonical);
  if (
    !inside ||
    inside === '..' ||
    inside.startsWith('..' + sep) ||
    isAbsolute(inside)
  )
    throw new ExecutionFailure(
      'SOURCE_OUTSIDE_ROOT',
      'Fonte fora da raiz autorizada.',
    );
  signal.throwIfAborted();
  await access(canonical, constants.R_OK);
  const original = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await original.stat();
    const checked = await stat(canonical);
    if (
      !before.isFile() ||
      before.ino !== checked.ino ||
      before.dev !== checked.dev ||
      (await realpath(canonical)) !== canonical
    )
      throw new ExecutionFailure(
        'SOURCE_CHANGED',
        'Fonte alterada durante a resolução.',
      );
    const cap =
      kind === 'VIDEO'
        ? 512 * 1024 ** 2
        : kind === 'AUDIO'
          ? 64 * 1024 ** 2
          : 16 * 1024 ** 2;
    if (!before.size || before.size > cap)
      throw new ExecutionFailure(
        'SOURCE_SIZE',
        'Fonte vazia ou acima do limite.',
      );
    const disk = await statfs(workspace);
    if (
      Number(disk.bavail) * Number(disk.bsize) <
      before.size + 256 * 1024 ** 2
    )
      throw new ExecutionFailure(
        'INSUFFICIENT_DISK',
        'Espaço temporário insuficiente para copiar a fonte com segurança.',
      );
    const extension = extname(canonical).toLowerCase();
    if (
      !/^\.(mp4|mov|webm|mkv|mp3|wav|aac|m4a|ogg|opus|flac|png|jpg|jpeg|webp)$/.test(
        extension,
      )
    )
      throw new ExecutionFailure(
        'SOURCE_FORMAT',
        'Formato de fonte incompatível.',
      );
    const target = join(workspace, `source-${id}${extension}`);
    const hash = createHash('sha256');
    let copied = 0;
    const input = createReadStream('', {
      fd: original.fd,
      autoClose: false,
      highWaterMark: 1024 * 1024,
    });
    input.on('data', (buffer: Buffer) => {
      copied += buffer.length;
      if (copied > cap)
        input.destroy(
          new ExecutionFailure(
            'SOURCE_SIZE',
            'Fonte excedeu o limite durante a cópia.',
          ),
        );
      else hash.update(buffer);
    });
    await pipeline(
      input,
      createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    const after = await original.stat();
    if (
      copied !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new ExecutionFailure(
        'SOURCE_CHANGED',
        'Fonte alterada durante a cópia.',
      );
    return { id, path: target, bytes: copied, sha256: hash.digest('hex') };
  } finally {
    await original.close();
  }
}
async function resolveAbortable<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () =>
      reject(new ExecutionFailure('CANCELLED', 'Resolução cancelada.'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([task(), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
