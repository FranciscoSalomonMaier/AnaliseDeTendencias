import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import type { TextStyle } from './graphics.schema';
export const GRAPHICS_RENDERER_VERSION = 1;
export const graphicsDependencyVersions = {
  sharp: sharp.versions.sharp,
  vips: sharp.versions.vips,
  pango: sharp.versions.pango,
  rsvg: sharp.versions.rsvg,
  bundledAssetsVersion: 1,
  twemoji: '17.0.2',
};
export const graphicsAssets = join(__dirname, 'assets');
export const fontCatalog = Object.freeze([
  {
    id: 'NOTO_SANS',
    family: 'Noto Sans',
    weights: [400, 700],
    italic: true,
    license: 'OFL-1.1',
    roles: [
      'TITLE',
      'CAPTIONS',
      'INFORMATION',
      'MINIMAL',
      'HUMOR',
      'CINEMATIC',
    ],
  },
  {
    id: 'NOTO_MONO',
    family: 'Noto Sans Mono',
    weights: [400, 700],
    italic: false,
    license: 'OFL-1.1',
    roles: ['INFORMATION', 'HORROR'],
  },
]);
export function fontFace(s: TextStyle) {
  const font = fontCatalog.find((f) => f.id === s.fontId)!;
  if (!font || (!font.italic && s.italic))
    throw Error('Variação tipográfica indisponível.');
  const suffix =
    s.weight === 700
      ? s.italic
        ? 'BoldItalic'
        : 'Bold'
      : s.italic
        ? 'Italic'
        : 'Regular';
  return {
    family: font.family,
    path: join(
      graphicsAssets,
      'fonts',
      `${s.fontId === 'NOTO_MONO' ? 'NotoSansMono' : 'NotoSans'}-${suffix}.ttf`,
    ),
  };
}
const emojiCodes = [
  '1f602',
  '1f923',
  '1f480',
  '1f525',
  '1f631',
  '1f440',
  '1f62d',
  '1f92f',
  '1f3c6',
  '1f947',
  '1f948',
  '1f949',
  '274c',
  '2705',
  '26a0',
];
export const emojiCharacters = [
  '😂',
  '🤣',
  '💀',
  '🔥',
  '😱',
  '👀',
  '😭',
  '🤯',
  '🏆',
  '🥇',
  '🥈',
  '🥉',
  '❌',
  '✅',
  '⚠️',
];
export function emojiFile(value: string) {
  const i = emojiCharacters.indexOf(value);
  if (i < 0) throw Error('Emoji não suportado.');
  return join(graphicsAssets, 'emoji', emojiCodes[i] + '.png');
}
export async function inspectGraphicsDependencies() {
  try {
    const manifest = JSON.parse(
      await readFile(join(graphicsAssets, 'manifest.json'), 'utf8'),
    ) as { files: Record<string, string> };
    for (const [name, hash] of Object.entries(manifest.files)) {
      const bytes = await readFile(join(graphicsAssets, name));
      if (createHash('sha256').update(bytes).digest('hex') !== hash)
        throw Error('Asset alterado.');
    }
    await access(
      fontFace({ fontId: 'NOTO_SANS', weight: 400, italic: false } as TextStyle)
        .path,
    );
    const sample = await sharp({
      text: {
        text: 'Ação',
        font: 'Noto Sans 24',
        fontfile: fontFace({
          fontId: 'NOTO_SANS',
          weight: 400,
          italic: false,
        } as TextStyle).path,
        rgba: true,
      },
    })
      .png()
      .toBuffer();
    return Boolean(
      sample.length && sharp.versions.pango && sharp.versions.rsvg,
    );
  } catch {
    return false;
  }
}
// Restrict implicit font fallback: only glyphs actually provided by bundled faces are accepted.
const coverageCache = new Map<string, Promise<(code: number) => boolean>>();
async function coverage(path: string) {
  const b = await readFile(path);
  let cmap = 0;
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const n = 12 + i * 16;
    if (b.toString('ascii', n, n + 4) === 'cmap') cmap = b.readUInt32BE(n + 8);
  }
  const tables: number[] = [];
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i++) {
    const n = cmap + 4 + i * 8;
    tables.push(cmap + b.readUInt32BE(n + 4));
  }
  return (code: number) =>
    tables.some((t) => {
      const format = b.readUInt16BE(t);
      if (format === 12) {
        const count = b.readUInt32BE(t + 12);
        for (let i = 0; i < count; i++) {
          const n = t + 16 + i * 12;
          if (code >= b.readUInt32BE(n) && code <= b.readUInt32BE(n + 4))
            return b.readUInt32BE(n + 8) + code - b.readUInt32BE(n) !== 0;
        }
      }
      if (format === 4 && code <= 65535) {
        const count = b.readUInt16BE(t + 6) / 2,
          end = t + 14,
          start = end + 2 * count + 2,
          delta = start + 2 * count,
          range = delta + 2 * count;
        for (let i = 0; i < count; i++) {
          if (
            code < b.readUInt16BE(start + 2 * i) ||
            code > b.readUInt16BE(end + 2 * i)
          )
            continue;
          const off = b.readUInt16BE(range + 2 * i),
            d = b.readInt16BE(delta + 2 * i);
          if (!off) return ((code + d) & 65535) !== 0;
          const index =
            range + 2 * i + off + 2 * (code - b.readUInt16BE(start + 2 * i));
          return index + 2 <= b.length && b.readUInt16BE(index) !== 0;
        }
      }
      return false;
    });
}
export async function assertGlyphs(text: string, style: TextStyle) {
  const path = fontFace(style).path;
  let cached = coverageCache.get(path);
  if (!cached) {
    cached = coverage(path);
    coverageCache.set(path, cached);
  }
  const has = await cached;
  for (const char of text)
    if (!/\s/u.test(char) && !has(char.codePointAt(0)!))
      throw Error('Caractere sem glifo nas fontes incluídas: ' + char);
}
