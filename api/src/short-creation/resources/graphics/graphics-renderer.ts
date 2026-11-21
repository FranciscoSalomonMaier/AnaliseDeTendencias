import { writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  graphicsLimits,
  graphicsParameterSchemas,
  isGraphicsId,
  textParametersSchema,
  textStyleSchema,
  type GraphicsUsage,
  type GraphicsAnimation,
  type TextParameters,
  type GraphicsPosition,
} from './graphics.schema';
import { GraphicsTextLayout, positionTexture } from './graphics-layout';
import { emojiFile } from './graphics-font-registry';
import {
  resourceUsageSchema,
  type ResourceUsage,
} from '../editing-resource.schema';
interface Element {
  image: Buffer;
  width: number;
  height: number;
  start: number;
  end: number;
  layer: number;
  order: number;
  position: GraphicsPosition;
  opacity: number;
  rotation: number;
  animations: GraphicsAnimation[];
}
export interface PreparedGraphic {
  path: string;
  width: number;
  height: number;
  x: number;
  y: number;
  start: number;
  end: number;
  layer: number;
  order: number;
  opacity: number;
  animations: GraphicsAnimation[];
}
export function parseGraphicsUsage(raw: unknown): GraphicsUsage {
  const u = resourceUsageSchema.parse(raw);
  if (
    !isGraphicsId(u.resourceId) ||
    u.resourceVersion !== 1 ||
    u.target.scope !== 'COMPOSITION' ||
    !u.target.clipId
  )
    throw Error('Gráficos exigem versão 1 e uma composição individual.');
  return {
    resourceId: u.resourceId,
    parameters: graphicsParameterSchemas[u.resourceId].parse(u.parameters),
  } as GraphicsUsage;
}
export function graphicsAssetIds(operations: ResourceUsage[]) {
  return [
    ...new Set(
      operations.flatMap((u) => {
        const p = parseGraphicsUsage(u);
        return p.resourceId === 'IMAGE_OVERLAY' || p.resourceId === 'LOGO'
          ? [p.parameters.assetId]
          : p.resourceId === 'WATERMARK' && p.parameters.kind === 'IMAGE'
            ? [p.parameters.assetId]
            : [];
      }),
    ),
  ];
}
export async function prepareGraphics(
  operations: ResourceUsage[],
  width: number,
  height: number,
  duration: number,
  workspace: string,
  lookup: (id: string) => Promise<string>,
  signal?: AbortSignal,
) {
  const usages = operations.map(parseGraphicsUsage),
    layout = new GraphicsTextLayout(),
    elements: Element[] = [],
    warnings: string[] = [];
  let animations = 0,
    characters = 0;
  const add = async (
    image: Buffer,
    p: Omit<Element, 'image' | 'width' | 'height' | 'order'>,
  ) => {
    if (signal?.aborted) throw Error('Execução cancelada.');
    const m = await sharp(image).metadata();
    if (!m.width || !m.height) throw Error('Elemento vazio.');
    if (p.start < 0 || p.end > duration + 1e-6 || p.end <= p.start)
      throw Error('Intervalo gráfico fora da duração final.');
    if (
      p.animations.filter((a) =>
        ['SCALE_IN', 'SCALE_OUT', 'POP', 'PULSE'].includes(a.type),
      ).length > 1
    )
      throw Error('Apenas uma animação de escala por elemento.');
    for (const a of p.animations)
      if (a.at + a.duration * a.repetitions > p.end - p.start + 1e-6)
        throw Error('Animação excede o intervalo do elemento.');
    animations += p.animations.length;
    if (animations > graphicsLimits.animations)
      throw Error('Excesso de animações.');
    elements.push({
      ...p,
      image,
      width: m.width,
      height: m.height,
      order: elements.length,
    });
    if (elements.length > graphicsLimits.elements)
      throw Error('Excesso de elementos gráficos.');
  };
  const text = async (
    runs: Parameters<GraphicsTextLayout['render']>[0],
    p: TextParameters,
  ) => {
    characters += runs.reduce((n, r) => n + r.text.length, 0);
    if (characters > 20000) throw Error('Complexidade textual excedida.');
    const texture = await layout.render(runs, p, width, height);
    if (texture.truncated)
      warnings.push('Texto truncado explicitamente pelo contrato TRUNCATE.');
    if (
      p.animations.some((a) => a.type === 'TYPEWRITER') &&
      texture.lines !== 1
    )
      throw Error('TYPEWRITER exige uma linha nesta versão.');
    const typewriter = p.animations.find((a) => a.type === 'TYPEWRITER');
    if (typewriter) {
      if (p.animations.length !== 1 || typewriter.repetitions !== 1)
        throw Error('TYPEWRITER admite uma animação e uma repetição.');
      const graphemes = [
        ...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(
          runs.map((r) => r.text).join(''),
        ),
      ].map((g) => g.segment);
      if (graphemes.length > 80 || runs.length !== 1)
        throw Error('TYPEWRITER admite um segmento de até 80 grafemas.');
      if (typewriter.duration / graphemes.length < 1 / 30)
        throw Error('TYPEWRITER exige pelo menos um frame por grafema.');
      const begin = p.start + typewriter.at,
        finish = begin + typewriter.duration;
      if (finish > (p.end ?? duration))
        throw Error('Animação excede o intervalo.');
      for (let i = 1; i <= graphemes.length; i++) {
        const partial = graphemes.slice(0, i).join('');
        if (!partial.trim()) continue;
        const state = await layout.render(
          [{ text: partial, style: runs[0].style }],
          { ...p, position: { ...p.position, align: 'LEFT' } },
          width,
          height,
        );
        const tile = await sharp({
          create: {
            width: texture.width,
            height: texture.height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .composite([
            {
              input: state.image,
              left: 0,
              top: Math.max(0, texture.height - state.height),
            },
          ])
          .png()
          .toBuffer();
        await add(tile, {
          ...p,
          animations: [],
          start: begin + ((i - 1) / graphemes.length) * typewriter.duration,
          end:
            i === graphemes.length
              ? (p.end ?? duration)
              : begin + (i / graphemes.length) * typewriter.duration,
        });
      }
    } else await add(texture.image, { ...p, end: p.end ?? duration });
  };
  const image = async (
    p: Extract<GraphicsUsage, { resourceId: 'IMAGE_OVERLAY' }>['parameters'],
  ) => {
    const path = await lookup(p.assetId),
      file = await stat(path);
    if (!file.isFile() || !file.size || file.size > graphicsLimits.imageBytes)
      throw Error('Imagem acima de 16 MB ou inválida.');
    const bytes = await readFile(path);
    const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      webp =
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !webp)
      throw Error('Assinatura de imagem incompatível.');
    const probe = sharp(bytes, {
        limitInputPixels: graphicsLimits.imagePixels,
        animated: false,
      }),
      m = await probe.metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(m.format ?? '') ||
      (m.pages && m.pages > 1) ||
      !m.width ||
      !m.height ||
      m.width > 4096 ||
      m.height > 4096
    )
      throw Error('Somente PNG, JPEG ou WebP estáticos até 4096 px.');
    const rendered = await probe
      .resize({
        width: Math.max(1, Math.round(width * p.width)),
        height: Math.max(1, Math.round(height * p.height)),
        fit: p.fit === 'COVER' ? 'cover' : 'inside',
        withoutEnlargement: false,
      })
      .ensureAlpha()
      .png()
      .toBuffer();
    await add(rendered, { ...p, end: p.end ?? duration });
  };
  const panels = usages.filter(
    (u): u is Extract<GraphicsUsage, { resourceId: 'RANKING_PANEL' }> =>
      u.resourceId === 'RANKING_PANEL',
  );
  if (new Set(panels.map((p) => p.parameters.panelId)).size !== panels.length)
    throw Error('Identificador de painel duplicado.');
  const reveals = usages.filter(
    (u): u is Extract<GraphicsUsage, { resourceId: 'RANKING_REVEAL' }> =>
      u.resourceId === 'RANKING_REVEAL',
  );
  if (new Set(reveals.map((p) => p.parameters.panelId)).size !== reveals.length)
    throw Error('Controle de revelação duplicado.');
  for (const r of reveals)
    if (!panels.some((p) => p.parameters.panelId === r.parameters.panelId))
      throw Error('Painel de ranking inexistente.');
  for (const usage of usages) {
    const p = usage.parameters;
    switch (usage.resourceId) {
      case 'RANKING_REVEAL':
        break;
      case 'IMAGE_OVERLAY':
      case 'LOGO':
        await image(usage.parameters);
        break;
      case 'WATERMARK':
        if (usage.parameters.kind === 'IMAGE') await image(usage.parameters);
        else await text([{ text: usage.parameters.text }], usage.parameters);
        break;
      case 'EMOJI': {
        const s = Math.max(
          1,
          Math.round((usage.parameters.size * width) / 1080),
        );
        await add(
          await sharp(emojiFile(usage.parameters.emoji))
            .resize(s, s)
            .png()
            .toBuffer(),
          { ...usage.parameters, end: usage.parameters.end ?? duration },
        );
        break;
      }
      case 'FIXED_TITLE':
      case 'TEMPORARY_TEXT':
      case 'TEXT_ANIMATION':
        await text([{ text: usage.parameters.text }], usage.parameters);
        break;
      case 'STYLED_TEXT':
        await text(
          usage.parameters.segments,
          usage.parameters as TextParameters,
        );
        break;
      case 'CAPTIONS':
        for (const c of usage.parameters.captions) {
          if (
            c.start < usage.parameters.start ||
            c.end > (usage.parameters.end ?? duration)
          )
            throw Error('Legenda fora do intervalo declarado.');
          await text([{ text: c.text }], { ...usage.parameters, ...c });
        }
        break;
      case 'WORD_HIGHLIGHT': {
        const q = usage.parameters,
          start = q.start,
          end = q.end ?? duration;
        const phases =
          q.mode === 'STATIC'
            ? [{ start, end, index: -1 }]
            : q.words.flatMap((w, i) => [
                { start: w.start!, end: w.end!, index: i },
                ...(i === 0 && w.start! > start
                  ? [{ start, end: w.start!, index: -2 }]
                  : []),
                ...(i < q.words.length - 1 && w.end! < q.words[i + 1].start!
                  ? [{ start: w.end!, end: q.words[i + 1].start!, index: -2 }]
                  : []),
                ...(i === q.words.length - 1 && w.end! < end
                  ? [{ start: w.end!, end, index: -2 }]
                  : []),
              ]);
        for (const phase of phases) {
          if (phase.start < start || phase.end > end)
            throw Error('Palavra fora do intervalo declarado.');
          await text(
            q.words.map((w, i) => ({
              text: w.text + (i < q.words.length - 1 ? ' ' : ''),
              style:
                (q.mode === 'STATIC' && w.highlight) || i === phase.index
                  ? q.highlightStyle
                  : undefined,
            })),
            { ...q, ...phase },
          );
        }
        break;
      }
      case 'RANKING_PANEL': {
        const q = usage.parameters,
          end = q.end ?? duration,
          r = reveals.find(
            (r) => r.parameters.panelId === q.panelId,
          )?.parameters;
        if (
          r &&
          r.reveals.some(
            (e) =>
              !q.items.some((i) => i.position === e.position) ||
              e.revealAt < q.start ||
              e.revealAt >= end,
          )
        )
          throw Error('Posição ou instante de revelação inválido.');
        const count = q.items.length,
          gap = (q.gap * width) / 1080,
          horizontal = q.orientation === 'HORIZONTAL';
        const cellW = horizontal
          ? (width * q.position.maxWidth - gap * (count - 1)) / count
          : width * q.position.maxWidth;
        const cellH = horizontal
          ? height * q.position.maxHeight
          : (height * q.position.maxHeight - gap * (count - 1)) / count;
        if (cellW < 8 || cellH < 8)
          throw Error('Área de ranking insuficiente.');
        const base = {
          ...q,
          position: {
            ...q.position,
            maxWidth: cellW / width,
            maxHeight: cellH / height,
          },
          maxLines: Math.min(3, q.maxLines),
        };
        // Measure each slot once and keep its geometry fixed through every reveal state.
        const textures: Array<{
          normal: Buffer;
          active: Buffer;
          hidden?: Buffer;
          width: number;
          height: number;
        }> = [];
        for (const item of q.items) {
          const label = `${item.position}. ${item.label}${item.emoji ? ' ' + item.emoji : ''}`,
            style = textStyleSchema.parse({ ...q.style, ...item.style });
          const normal = await layout.render(
            [{ text: label }],
            { ...base, style } as TextParameters,
            width,
            height,
          );
          const active = await layout.render(
            [
              {
                text: label,
                style: { color: r?.highlightColor ?? style.color },
              },
            ],
            { ...base, style } as TextParameters,
            width,
            height,
          );
          let hidden: Buffer | undefined;
          if (r && ['NUMBER', 'QUESTION', 'CUSTOM'].includes(r.unrevealed)) {
            const placeholder =
              r.unrevealed === 'NUMBER'
                ? `${item.position}.`
                : r.unrevealed === 'CUSTOM'
                  ? r.placeholder
                  : '???';
            hidden = (
              await layout.render(
                [{ text: placeholder }],
                { ...base, style } as TextParameters,
                width,
                height,
              )
            ).image;
          }
          textures.push({
            normal: normal.image,
            active: active.image,
            hidden,
            width: Math.ceil(cellW),
            height: Math.ceil(cellH),
          });
        }
        const panelW = Math.ceil(
            horizontal ? width * q.position.maxWidth : cellW,
          ),
          panelH = Math.ceil(
            horizontal ? cellH : height * q.position.maxHeight,
          ),
          origin = positionTexture(q.position, panelW, panelH, width, height);
        for (let i = 0; i < count; i++) {
          const slot = textures[i],
            event = r?.reveals.find((e) => e.position === q.items[i].position),
            begin = event?.revealAt ?? (r ? end : q.start),
            states: Array<{ image: Buffer; start: number; end: number }> = [];
          if (slot.hidden && begin > q.start)
            states.push({ image: slot.hidden, start: q.start, end: begin });
          if (begin < end) {
            const activeEnd = Math.min(
              end,
              begin + (r?.highlightDuration ?? 0),
            );
            if (activeEnd > begin)
              states.push({ image: slot.active, start: begin, end: activeEnd });
            if (activeEnd < end)
              states.push({ image: slot.normal, start: activeEnd, end });
          }
          for (const state of states) {
            const m = await sharp(state.image).metadata(),
              tile = await sharp({
                create: {
                  width: slot.width,
                  height: slot.height,
                  channels: 4,
                  background: { r: 0, g: 0, b: 0, alpha: 0 },
                },
              })
                .composite([
                  {
                    input: state.image,
                    left: Math.max(0, Math.floor((slot.width - m.width!) / 2)),
                    top: Math.max(0, Math.floor((slot.height - m.height!) / 2)),
                  },
                ])
                .png()
                .toBuffer();
            await add(tile, {
              ...q,
              ...state,
              rotation: 0,
              position: {
                ...q.position,
                x: (origin.x + (horizontal ? i * (cellW + gap) : 0)) / width,
                y: (origin.y + (horizontal ? 0 : i * (cellH + gap))) / height,
                anchor: 'TOP_LEFT',
                maxWidth: cellW / width,
                maxHeight: cellH / height,
              },
            });
          }
        }
        break;
      }
    }
  }
  const times = elements
    .flatMap((e) => [
      { t: e.start, n: 1 },
      { t: e.end, n: -1 },
    ])
    .sort((a, b) => a.t - b.t || a.n - b.n);
  let live = 0;
  for (const t of times) {
    live += t.n;
    if (live > graphicsLimits.simultaneous)
      throw Error('Excesso de elementos simultâneos.');
  }
  let pixels = 0;
  const prepared: PreparedGraphic[] = [];
  for (const e of elements) {
    let image = e.image;
    if (e.rotation)
      image = await sharp(image)
        .rotate(e.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    const m = await sharp(image).metadata();
    pixels += m.width! * m.height!;
    if (pixels > graphicsLimits.texturePixels)
      throw Error('Orçamento de texturas excedido.');
    const box = positionTexture(e.position, m.width!, m.height!, width, height);
    const maxScale = Math.max(
      1,
      ...e.animations.map((a) =>
        ['SCALE_IN', 'SCALE_OUT'].includes(a.type)
          ? Math.max(a.scaleFrom, a.scaleTo)
          : a.type === 'POP'
            ? 1 + a.intensity
            : a.type === 'PULSE'
              ? 1 + a.intensity * 0.2
              : 1,
      ),
    );
    if (
      box.x - (m.width! * (maxScale - 1)) / 2 < 0 ||
      box.y - (m.height! * (maxScale - 1)) / 2 < 0 ||
      box.x + (m.width! * (maxScale + 1)) / 2 > width ||
      box.y + (m.height! * (maxScale + 1)) / 2 > height
    )
      throw Error(
        'Animação de escala pode recortar o elemento; reduza o tamanho ou reveja a posição.',
      );
    warnings.push(...box.warnings);
    if (box.warnings.length && !e.position.allowOutsideSafeArea)
      throw Error(
        'Elemento fora da área segura estimada; revise a posição ou autorize explicitamente.',
      );
    const path = join(workspace, `graphic-${e.order}.png`);
    await writeFile(path, image, { mode: 0o600 });
    prepared.push({ ...e, ...box, path, width: m.width!, height: m.height! });
  }
  for (let i = 0; i < prepared.length; i++)
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i],
        b = prepared[j];
      if (
        a.start < b.end &&
        b.start < a.end &&
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        warnings.push(
          `Sobreposição intencional possível entre elementos ${a.order} e ${b.order}.`,
        );
    }
  return {
    elements: prepared.sort((a, b) => a.layer - b.layer || a.order - b.order),
    warnings: [...new Set(warnings)],
    texturePixels: pixels,
  };
}
