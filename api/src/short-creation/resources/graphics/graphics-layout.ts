import sharp from 'sharp';
import {
  assertGlyphs,
  emojiCharacters,
  emojiFile,
  fontFace,
} from './graphics-font-registry';
import {
  textStyleSchema,
  type TextStyle,
  type TextParameters,
  type GraphicsPosition,
} from './graphics.schema';
export const escapeMarkup = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
type Run = { text: string; style?: Partial<TextStyle> };
interface Token {
  image: Buffer;
  width: number;
  height: number;
  space: boolean;
  newline: boolean;
  style: TextStyle;
}
export interface TextTexture {
  image: Buffer;
  width: number;
  height: number;
  lines: number;
  truncated: boolean;
}
async function coloredMask(
  mask: Buffer,
  width: number,
  height: number,
  color: string,
  opacity: number,
) {
  const alpha = await sharp(mask).linear(opacity).toBuffer();
  return sharp({ create: { width, height, channels: 3, background: color } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
}
export class GraphicsTextLayout {
  private cache = new Map<string, Promise<Token>>();
  private async token(
    text: string,
    s: TextStyle,
    scale: number,
  ): Promise<Token> {
    const key = JSON.stringify([text, s, scale]);
    let cached = this.cache.get(key);
    if (cached) return cached;
    cached = (async () => {
      const emoji = emojiCharacters.includes(text),
        size = Math.max(1, Math.round(s.size * scale));
      if (text === '\n')
        return {
          image: Buffer.alloc(0),
          width: 0,
          height: size,
          space: false,
          newline: true,
          style: s,
        };
      if (/^\s+$/u.test(text))
        return {
          image: Buffer.alloc(0),
          width: size * 0.3 * text.length,
          height: size,
          space: true,
          newline: false,
          style: s,
        };
      let raw: Buffer;
      if (emoji)
        raw = await sharp(emojiFile(text)).resize(size, size).png().toBuffer();
      else {
        await assertGlyphs(text, s);
        const face = fontFace(s);
        const markup = `<span foreground="${s.color}" alpha="${Math.round(s.opacity * 65535)}" weight="${s.weight}" style="${s.italic ? 'italic' : 'normal'}" underline="${s.underline ? 'single' : 'none'}" letter_spacing="${Math.round(s.letterSpacing * scale * 1024)}">${escapeMarkup(text)}</span>`;
        raw = await sharp({
          text: {
            text: markup,
            font: `${face.family} ${size}`,
            fontfile: face.path,
            rgba: true,
            dpi: 72,
          },
        })
          .png()
          .toBuffer();
      }
      const m = await sharp(raw).metadata(),
        pad = Math.ceil(
          (s.outlineWidth +
            Math.max(Math.abs(s.shadowX), Math.abs(s.shadowY)) +
            2) *
            scale,
        ),
        width = m.width! + 2 * pad,
        height = m.height! + 2 * pad;
      const foreground = await sharp(raw)
        .extend({
          top: pad,
          bottom: pad,
          left: pad,
          right: pad,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      const layers: sharp.OverlayOptions[] = [];
      if (s.background) {
        const bw = width + Math.ceil(Math.abs(s.shadowX) * scale),
          bh = height + Math.ceil(Math.abs(s.shadowY) * scale);
        layers.push({
          input: Buffer.from(
            `<svg width="${bw}" height="${bh}"><rect width="100%" height="100%" rx="${Math.round(s.radius * scale)}" fill="${s.background}" fill-opacity="${s.backgroundOpacity}"/></svg>`,
          ),
          left: 0,
          top: 0,
        });
      }
      if (s.shadowOpacity > 0) {
        const mask = await sharp(foreground)
          .extractChannel(3)
          .blur(Math.max(0.3, scale))
          .png()
          .toBuffer();
        const shadow = await coloredMask(
          mask,
          width,
          height,
          s.shadowColor,
          s.shadowOpacity,
        );
        const dx = Math.round(s.shadowX * scale),
          dy = Math.round(s.shadowY * scale);
        const shifted = await sharp(shadow)
          .extract({
            left: Math.max(0, -dx),
            top: Math.max(0, -dy),
            width: width - Math.abs(dx),
            height: height - Math.abs(dy),
          })
          .png()
          .toBuffer();
        layers.push({
          input: shifted,
          left: Math.max(0, dx),
          top: Math.max(0, dy),
        });
      }
      if (s.outlineWidth > 0) {
        const mask = await sharp(foreground)
          .extractChannel(3)
          .dilate(Math.max(1, Math.round(s.outlineWidth * scale)))
          .png()
          .toBuffer();
        layers.push({
          input: await coloredMask(
            mask,
            width,
            height,
            s.outlineColor,
            s.opacity,
          ),
          left: 0,
          top: 0,
        });
      }
      layers.push({ input: foreground, left: 0, top: 0 });
      // Offset shadows remain inside the transparent padding, with no larger intermediate canvas.
      const image = await sharp({
        create: {
          width: width + Math.ceil(Math.abs(s.shadowX) * scale),
          height: height + Math.ceil(Math.abs(s.shadowY) * scale),
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(
          layers.map((l) => ({
            ...l,
            left: Math.max(0, l.left ?? 0),
            top: Math.max(0, l.top ?? 0),
          })),
        )
        .png()
        .toBuffer();
      const final = await sharp(image).metadata();
      return {
        image,
        width: final.width!,
        height: final.height!,
        space: false,
        newline: false,
        style: s,
      };
    })();
    this.cache.set(key, cached);
    if (this.cache.size > 2048)
      this.cache.delete(this.cache.keys().next().value!);
    return cached;
  }
  async render(
    runs: Run[],
    p: TextParameters,
    width: number,
    height: number,
  ): Promise<TextTexture> {
    const scale = width / 1080,
      maxW = Math.floor(width * p.position.maxWidth),
      maxH = Math.floor(height * p.position.maxHeight),
      pad = Math.ceil(p.style.padding * scale);
    if (maxW < 4 || maxH < 4) throw Error('Área textual insuficiente.');
    const transformed = runs.map((r) => {
      const transform = r.style?.transform ?? p.style.transform;
      return {
        ...r,
        text:
          transform === 'UPPERCASE'
            ? r.text.toUpperCase()
            : transform === 'LOWERCASE'
              ? r.text.toLowerCase()
              : r.text,
      };
    });
    for (
      let size = p.style.size;
      size >= Math.min(p.minSize, p.style.size);
      size -= 2
    ) {
      const tokens: Token[] = [];
      for (const run of transformed) {
        const s = textStyleSchema.parse({
          ...p.style,
          ...run.style,
          background: run.style?.background,
          size: run.style?.size ? (run.style.size * size) / p.style.size : size,
        });
        // Emoji graphemes are separated from words without allowing unsupported glyph fallback.
        const pieces = run.text.match(/\n|[^\S\n]+|[^\s]+/gu) ?? [];
        for (const piece of pieces) {
          let pending = '';
          for (const g of new Intl.Segmenter('pt', {
            granularity: 'grapheme',
          }).segment(piece)) {
            if (emojiCharacters.includes(g.segment)) {
              if (pending) {
                tokens.push(await this.token(pending, s, scale));
                pending = '';
              }
              tokens.push(await this.token(g.segment, s, scale));
            } else pending += g.segment;
          }
          if (pending) tokens.push(await this.token(pending, s, scale));
        }
      }
      const lines: Token[][] = [[]];
      let currentW = 0,
        overflow = false,
        truncated = false;
      for (const t of tokens) {
        if (t.newline) {
          lines.push([]);
          currentW = 0;
          continue;
        }
        if (t.width > maxW - 2 * pad) {
          overflow = true;
          break;
        }
        if (currentW + t.width > maxW - 2 * pad) {
          if (p.overflow === 'REJECT') {
            overflow = true;
            break;
          }
          lines.push([]);
          currentW = 0;
        }
        if (!currentW && t.space) continue;
        lines.at(-1)!.push(t);
        currentW += t.width;
      }
      if (lines.length > p.maxLines) {
        if (p.overflow === 'TRUNCATE') {
          lines.length = p.maxLines;
          truncated = true;
        } else overflow = true;
      }
      const heights = lines.map(
          (l) => Math.max(1, ...l.map((t) => t.height)) * p.style.lineSpacing,
        ),
        outH = Math.ceil(heights.reduce((a, b) => a + b, 0) + 2 * pad);
      if (outH > maxH) overflow = true;
      if (overflow) {
        if (p.overflow === 'SHRINK') continue;
        throw Error('Texto excede a área, as linhas ou a largura permitida.');
      }
      const widths = lines.map((l) => l.reduce((n, t) => n + t.width, 0)),
        outW = Math.max(2, Math.ceil(Math.max(...widths) + 2 * pad));
      const layers: sharp.OverlayOptions[] = [];
      let y = pad;
      for (let i = 0; i < lines.length; i++) {
        let x =
          pad +
          (p.position.align === 'CENTER'
            ? (outW - 2 * pad - widths[i]) / 2
            : p.position.align === 'RIGHT'
              ? outW - 2 * pad - widths[i]
              : 0);
        for (const t of lines[i]) {
          if (!t.space)
            layers.push({
              input: t.image,
              left: Math.round(x),
              top: Math.round(
                y + (heights[i] / p.style.lineSpacing - t.height),
              ),
            });
          x += t.width;
        }
        y += heights[i];
      }
      let image = sharp({
        create: {
          width: outW,
          height: Math.max(2, outH),
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      });
      if (p.style.background) {
        const r = Math.round(p.style.radius * scale);
        const svg = `<svg width="${outW}" height="${outH}"><rect width="100%" height="100%" rx="${r}" fill="${p.style.background}" fill-opacity="${p.style.backgroundOpacity}"/></svg>`;
        layers.unshift({ input: Buffer.from(svg), left: 0, top: 0 });
      }
      image = image.composite(layers);
      return {
        image: await image.png().toBuffer(),
        width: outW,
        height: outH,
        lines: lines.length,
        truncated,
      };
    }
    throw Error('Texto não cabe no tamanho mínimo permitido.');
  }
}
export function positionTexture(
  p: GraphicsPosition,
  w: number,
  h: number,
  cw: number,
  ch: number,
) {
  const ax = p.anchor.endsWith('LEFT')
      ? 0
      : p.anchor.endsWith('RIGHT')
        ? 1
        : 0.5,
    ay = p.anchor.startsWith('TOP')
      ? 0
      : p.anchor.startsWith('BOTTOM')
        ? 1
        : 0.5;
  const x = Math.round(p.x * cw - ax * w),
    y = Math.round(p.y * ch - ay * h),
    m = p.safeMargins;
  const outside =
    x < cw * m.left ||
    y < ch * m.top ||
    x + w > cw * (1 - m.right) ||
    y + h > ch * (1 - m.bottom);
  if (x < 0 || y < 0 || x + w > cw || y + h > ch)
    throw Error('Elemento gráfico fora da composição.');
  return {
    x,
    y,
    warnings: outside
      ? [`Elemento fora da área segura estimada ${p.safeProfile}.`]
      : [],
  };
}
