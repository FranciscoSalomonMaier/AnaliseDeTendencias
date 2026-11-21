import { isAudioId } from './audio/audio.schema';
import { isGraphicsId } from './graphics/graphics.schema';
import {
  RESOURCE_LIBRARY_VERSION,
  resourceCompositionSchema,
  resourceCanvasSchema,
  resourceAssetMetadataSchema,
  type ResourceAssetMetadata,
  type ResourceCanvas,
} from './editing-resource.schema';
import { validateResourceUsage } from './editing-resource.validator';
import {
  resourceDuration,
  resourceInterval,
  toFrames,
  toSeconds,
} from './editing-resource.duration';
import type {
  ResourceCapability,
  ValidatedResourceUsage,
  DurationImpact,
} from './editing-resource.types';
interface Composition {
  fit: 'FIT' | 'FILL';
  x: number;
  y: number;
  widthFraction: number;
  heightFraction: number;
  background: { color: string } | { sigma: number };
}
interface Clip {
  label: string;
  frames: number;
  width: number;
  height: number;
  composition?: Composition;
}
const f = (value: number) => value.toFixed(6);
const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
export function easingProgress(
  curve: 'LINEAR' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_OUT',
  progress: string,
) {
  if (curve === 'EASE_IN') return `(${progress})*(${progress})`;
  if (curve === 'EASE_OUT') return `1-(1-(${progress}))*(1-(${progress}))`;
  if (curve === 'EASE_IN_OUT')
    return `(${progress})*(${progress})*(3-2*(${progress}))`;
  return progress;
}
/** Ordered local filter composition; no jobs, project timeline, storage or editorial decisions. */
export function compileResourceComposition(
  raw: unknown,
  rawAssets: readonly ResourceAssetMetadata[],
  capabilities: readonly ResourceCapability[],
  canvasInput: Partial<ResourceCanvas> = {},
) {
  if (
    resourceCompositionSchema
      .parse(raw)
      .operations.some((u) => isAudioId(u.resourceId))
  )
    throw Error('Utilize AudioResourceExecutor para operações sonoras.');
  if (
    resourceCompositionSchema
      .parse(raw)
      .operations.some((u) => isGraphicsId(u.resourceId))
  )
    throw Error(
      'Recursos gráficos exigem preparação de assets pelo EditingResourceExecutor.',
    );
  const request = resourceCompositionSchema.parse(raw),
    canvas = resourceCanvasSchema.parse(canvasInput);
  const usages = request.operations.map((item) =>
    validateResourceUsage(item, capabilities),
  );
  const assets = rawAssets.map((item) =>
    resourceAssetMetadataSchema.parse(item),
  );
  if (
    assets.length > 8 ||
    new Set(assets.map((item) => item.id)).size !== assets.length
  )
    throw Error('Origens duplicadas ou acima do limite.');
  let serial = 0;
  const graph: string[] = [],
    states = new Map<string, Clip>(),
    consumed = new Set<string>(),
    inputIds: string[] = [],
    impacts: Array<
      DurationImpact & { resourceId: string; resourceVersion: number }
    > = [];
  const emit = (inputs: string[], filter: string) => {
    const out = `r${serial++}`;
    graph.push(
      inputs.map((label) => `[${label}]`).join('') + filter + `[${out}]`,
    );
    return out;
  };
  const get = (id: string): Clip => {
    if (consumed.has(id))
      throw Error('Trecho já consumido por uma combinação.');
    if (states.has(id)) return states.get(id)!;
    const asset = assets.find((item) => item.id === id);
    if (!asset) throw Error('Origem de vídeo desconhecida.');
    inputIds.push(id);
    const index = inputIds.length - 1,
      frames = Math.max(1, toFrames(asset.duration));
    const label = emit(
      [`${index}:v:0`],
      `setsar=1,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p,fps=30,tpad=stop_mode=clone:stop=1,trim=end_frame=${frames}`,
    );
    const state = { label, frames, width: asset.width, height: asset.height };
    states.set(id, state);
    return state;
  };
  const defaultComposition = (): Composition => ({
    fit: 'FILL',
    x: 0.5,
    y: 0.5,
    widthFraction: 1,
    heightFraction: 1,
    background: { color: '#000000' },
  });
  const materialize = (clip: Clip): Clip => {
    if (
      !clip.composition &&
      clip.width === canvas.width &&
      clip.height === canvas.height
    )
      return clip;
    const c = clip.composition ?? defaultComposition(),
      w = even(canvas.width * c.widthFraction),
      h = even(canvas.height * c.heightFraction);
    const foreground =
      `scale=${w}:${h}:force_original_aspect_ratio=${c.fit === 'FIT' ? 'decrease' : 'increase'}:force_divisible_by=2` +
      (c.fit === 'FILL'
        ? `,crop=${w}:${h}:(iw-ow)*${f(c.x)}:(ih-oh)*${f(c.y)}`
        : '');
    let label: string;
    if ('color' in c.background) {
      label = emit(
        [clip.label],
        foreground +
          `,pad=${canvas.width}:${canvas.height}:(ow-iw)*${f(c.x)}:(oh-ih)*${f(c.y)}:color=0x${c.background.color.slice(1)},setsar=1`,
      );
    } else {
      const back = `r${serial++}`,
        front = `r${serial++}`;
      graph.push(`[${clip.label}]split=2[${back}][${front}]`);
      const bg = emit(
        [back],
        `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase,crop=${canvas.width}:${canvas.height},gblur=sigma=${f(c.background.sigma)}`,
      );
      const fg = emit([front], foreground);
      label = emit(
        [bg, fg],
        `overlay=x=(W-w)*${f(c.x)}:y=(H-h)*${f(c.y)}:shortest=1,setsar=1`,
      );
    }
    return {
      label,
      frames: clip.frames,
      width: canvas.width,
      height: canvas.height,
    };
  };
  const split = (label: string, count: number) => {
    if (count === 1) return [label];
    const outputs = Array.from({ length: count }, () => `r${serial++}`);
    graph.push(
      `[${label}]split=${count}` +
        outputs.map((label) => `[${label}]`).join(''),
    );
    return outputs;
  };
  const trim = (clip: Clip, start: number, end: number): Clip => ({
    ...clip,
    label: emit(
      [clip.label],
      `trim=start_frame=${start}:end_frame=${end},setpts=PTS-STARTPTS,settb=AVTB`,
    ),
    frames: end - start,
  });
  const joinClips = (clips: Clip[]): Clip => {
    if (clips.length === 1) return clips[0];
    return {
      ...clips[0],
      label: emit(
        clips.map((c) => c.label),
        `concat=n=${clips.length}:v=1:a=0,settb=AVTB,setpts=PTS-STARTPTS`,
      ),
      frames: clips.reduce((n, c) => n + c.frames, 0),
    };
  };
  const intervalEffect = (
    clip: Clip,
    usage: ValidatedResourceUsage,
    transform: (middle: Clip) => Clip,
  ): Clip => {
    const range = resourceInterval(usage, clip.frames),
      ranges: Array<[number, number]> = [];
    if (range.start > 0) ranges.push([0, range.start]);
    ranges.push([range.start, range.end]);
    if (range.end < clip.frames) ranges.push([range.end, clip.frames]);
    const labels = split(clip.label, ranges.length);
    const pieces = ranges.map(([start, end], i) => {
      const piece = trim({ ...clip, label: labels[i] }, start, end);
      return start === range.start && end === range.end
        ? transform(piece)
        : piece;
    });
    return joinClips(pieces);
  };
  for (const usage of usages) {
    const target = usage.target;
    const ids =
      target.scope === 'SOURCE_INTERVAL'
        ? [target.sourceId]
        : target.scope === 'BETWEEN_CLIPS'
          ? [target.fromClipId, target.toClipId]
          : target.scope === 'COMPOSITION'
            ? (target.clipIds ?? [target.clipId!])
            : [target.clipId];
    if (usage.resourceId === 'CUT' && states.has(ids[0]))
      throw Error(
        'CUT usa o relógio original e deve preceder outras operações sobre essa origem.',
      );
    let clips = ids.map(get);
    const inputDurations = clips.map((c) => toSeconds(c.frames));
    if (usage.resourceId === 'CUT')
      inputDurations[0] = assets.find((asset) => asset.id === ids[0])!.duration;
    const impact = resourceDuration(usage, inputDurations);
    impacts.push({
      resourceId: usage.resourceId,
      resourceVersion: usage.resourceVersion,
      ...impact,
    });
    let clip = clips[0];
    switch (usage.resourceId) {
      case 'CUT': {
        const range = resourceInterval(usage, clip.frames);
        clip = trim(clip, range.start, range.end);
        break;
      }
      case 'CONCAT':
      case 'HARD_CUT':
        clip = joinClips(clips.map(materialize));
        break;
      case 'CROSSFADE':
      case 'ZOOM_TRANSITION':
      case 'SLIDE_TRANSITION': {
        clips = clips.map(materialize).map((clip) => ({
          ...clip,
          label: emit([clip.label], 'settb=AVTB,setpts=PTS-STARTPTS,fps=30'),
        }));
        const transition =
          usage.resourceId === 'CROSSFADE'
            ? 'fade'
            : usage.resourceId === 'ZOOM_TRANSITION'
              ? 'zoomin'
              : {
                  LEFT: 'slideleft',
                  RIGHT: 'slideright',
                  UP: 'slideup',
                  DOWN: 'slidedown',
                }[usage.parameters.direction];
        clip = {
          ...clips[0],
          frames: toFrames(impact.outputSeconds),
          label: emit(
            clips.map((c) => c.label),
            `xfade=transition=${transition}:duration=${f(impact.overlapSeconds)}:offset=${f(toSeconds(clips[0].frames) - impact.overlapSeconds)},settb=AVTB,setpts=PTS-STARTPTS`,
          ),
        };
        break;
      }
      case 'RESIZE': {
        const p = usage.parameters;
        let w = p.width,
          h = p.height;
        if (p.preserveAspect) {
          const ratio = Math.min(w / clip.width, h / clip.height);
          w = even(clip.width * ratio);
          h = even(clip.height * ratio);
        }
        clip = {
          ...clip,
          label: emit([clip.label], `scale=${w}:${h},setsar=1`),
          width: w,
          height: h,
        };
        break;
      }
      case 'CROP': {
        clip = materializeIfPending(clip);
        const p = usage.parameters,
          w = even(clip.width * p.widthFraction),
          h = even(clip.height * p.heightFraction),
          x = Math.floor((clip.width * p.x) / 2) * 2,
          y = Math.floor((clip.height * p.y) / 2) * 2;
        clip = {
          ...clip,
          label: emit(
            [clip.label],
            `crop=${w}:${h}:${Math.min(clip.width - w, Math.max(0, x))}:${Math.min(clip.height - h, Math.max(0, y))}`,
          ),
          width: w,
          height: h,
        };
        break;
      }
      case 'POSITION':
      case 'FIT':
      case 'FILL':
      case 'SOLID_BACKGROUND':
      case 'BLUR_BACKGROUND': {
        const composition = clip.composition
          ? structuredClone(clip.composition)
          : defaultComposition();
        if (usage.resourceId === 'POSITION') {
          composition.x = usage.parameters.x;
          composition.y = usage.parameters.y;
        } else if (usage.resourceId === 'FIT' || usage.resourceId === 'FILL') {
          composition.fit = usage.resourceId;
          composition.widthFraction = usage.parameters.widthFraction;
          composition.heightFraction = usage.parameters.heightFraction;
        } else {
          if (!clip.composition) composition.fit = 'FIT';
          composition.background =
            usage.resourceId === 'SOLID_BACKGROUND'
              ? { color: usage.parameters.color }
              : { sigma: usage.parameters.sigma };
        }
        clip = { ...clip, composition };
        break;
      }
      case 'SPEED_CHANGE': {
        clip = materialize(clip);
        clip = intervalEffect(clip, usage, (middle) => {
          const frames = Math.max(
            1,
            Math.round(middle.frames / usage.parameters.factor),
          );
          return {
            ...middle,
            frames,
            label: emit(
              [middle.label],
              `setpts=(PTS-STARTPTS)/${f(usage.parameters.factor)},fps=30,tpad=stop_mode=clone:stop=1,trim=end_frame=${frames},settb=AVTB,setpts=PTS-STARTPTS`,
            ),
          };
        });
        break;
      }
      case 'FREEZE_FRAME': {
        clip = materialize(clip);
        const at = Math.min(clip.frames - 1, toFrames(usage.parameters.at)),
          frames = toFrames(impact.outputSeconds);
        clip = {
          ...clip,
          frames,
          label: emit(
            [clip.label],
            `trim=start_frame=${at}:end_frame=${at + 1},setpts=PTS-STARTPTS,loop=loop=${frames - 1}:size=1:start=0,setpts=N/(30*TB),trim=end_frame=${frames},settb=AVTB`,
          ),
        };
        break;
      }
      case 'REPEAT_SEGMENT': {
        clip = materialize(clip);
        clip = intervalEffect(clip, usage, (middle) =>
          joinClips(
            split(middle.label, usage.parameters.count).map((label) => ({
              ...middle,
              label,
            })),
          ),
        );
        break;
      }
      default: {
        clip = materialize(clip);
        clip = intervalEffect(clip, usage, (middle) => {
          const filter = effectFilter(usage, middle, canvas);
          return filter
            ? { ...middle, label: emit([middle.label], filter) }
            : middle;
        });
      }
    }
    clip.frames = toFrames(impact.outputSeconds);
    states.set(ids[0], clip);
    for (const id of ids.slice(1)) {
      states.delete(id);
      consumed.add(id);
    }
  }
  function materializeIfPending(clip: Clip) {
    return clip.composition ? materialize(clip) : clip;
  }
  if (states.size !== 1)
    throw Error(
      'A composição local deve resultar em um único trecho; concatene as saídas independentes.',
    );
  let final = materialize([...states.values()][0]);
  final = {
    ...final,
    label: emit(
      [final.label],
      `setsar=1,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p,fps=30,tpad=stop_mode=clone:stop=1,trim=end_frame=${final.frames}`,
    ),
  };
  return {
    libraryVersion: RESOURCE_LIBRARY_VERSION,
    outputClipId: [...states.keys()][0],
    contractVersion: 1,
    filterGraph: graph.join(';'),
    outputLabel: final.label,
    inputIds,
    expectedDuration: toSeconds(final.frames),
    expectedFrames: final.frames,
    width: canvas.width,
    height: canvas.height,
    fps: 30,
    impacts,
  };
}
function effectFilter(
  usage: ValidatedResourceUsage,
  clip: Clip,
  canvas: ResourceCanvas,
): string {
  switch (usage.resourceId) {
    case 'STATIC_ZOOM':
    case 'DYNAMIC_ZOOM': {
      const p = usage.parameters,
        start =
          usage.resourceId === 'STATIC_ZOOM'
            ? usage.parameters.scale
            : usage.parameters.startScale,
        end =
          usage.resourceId === 'STATIC_ZOOM'
            ? start
            : usage.parameters.endScale;
      const progress = easingProgress(
        usage.resourceId === 'DYNAMIC_ZOOM'
          ? usage.parameters.easing
          : 'LINEAR',
        `min(1,on/${Math.max(1, clip.frames - 1)})`,
      );
      return `zoompan=z='${f(start)}+(${f(end - start)})*(${progress})':x='max(0,min(iw-iw/zoom,iw*${f(p.focusX)}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*${f(p.focusY)}-ih/zoom/2))':d=1:s=${canvas.width}x${canvas.height}:fps=30,settb=AVTB`;
    }
    case 'CAMERA_SHAKE': {
      const p = usage.parameters;
      if (!p.intensity) return '';
      const w = Math.ceil((canvas.width * (1 + 2 * p.intensity)) / 2) * 2,
        h = Math.ceil((canvas.height * (1 + 2 * p.intensity)) / 2) * 2,
        phase = ((p.seed % 10000) / 10000) * Math.PI * 2;
      return `scale=${w}:${h},crop=${canvas.width}:${canvas.height}:x='(iw-ow)/2*(1+${p.horizontal ? `sin(2*PI*${f(p.frequency)}*t+${f(phase)})` : '0'})':y='(ih-oh)/2*(1+${p.vertical ? `sin(2*PI*${f(p.frequency * 0.83)}*t+${f(phase + 1)})` : '0'})'`;
    }
    case 'MOTION_BLUR': {
      const count = 1 + Math.round(usage.parameters.intensity * 4);
      return count === 1
        ? ''
        : `tmix=frames=${count}:weights='${Array(count).fill('1').join(' ')}'`;
    }
    case 'GAUSSIAN_BLUR':
      return usage.parameters.sigma
        ? `gblur=sigma=${f(usage.parameters.sigma)}`
        : '';
    case 'VIGNETTE':
      return usage.parameters.intensity
        ? `vignette=angle=${f((usage.parameters.intensity * Math.PI) / 3)}:dither=0`
        : '';
    case 'FILM_GRAIN': {
      const p = usage.parameters;
      return p.intensity
        ? `noise=alls=${f(p.intensity)}:allf=${p.temporal ? 't+u' : 'u'}:c0_seed=${p.seed}:c1_seed=${(p.seed + 1) % 2147483648}:c2_seed=${(p.seed + 2) % 2147483648}`
        : '';
    }
    case 'GLITCH': {
      const p = usage.parameters,
        pixels = Math.round(canvas.width * p.intensity);
      return pixels
        ? `format=gbrp,rgbashift=rh=${pixels}:bh=${-pixels}:edge=smear:enable='lt(mod(t*${f(p.frequency)},1),${f(p.dutyCycle)})',format=yuv420p`
        : '';
    }
    case 'FADE_IN':
    case 'FADE_OUT':
      return `fade=t=${usage.resourceId === 'FADE_IN' ? 'in' : 'out'}:st=${usage.resourceId === 'FADE_IN' ? '0' : f(toSeconds(clip.frames) - usage.parameters.duration)}:d=${f(usage.parameters.duration)}:color=0x${usage.parameters.color.slice(1)}`;
    case 'BRIGHTNESS':
      return `eq=brightness=${f(usage.parameters.value)}`;
    case 'CONTRAST':
      return `eq=contrast=${f(usage.parameters.value)}`;
    case 'SATURATION':
      return `eq=saturation=${f(usage.parameters.value)}`;
    case 'GAMMA':
      return `eq=gamma=${f(usage.parameters.value)}`;
    case 'COLOR_TEMPERATURE':
      return usage.parameters.kelvin === 6500 || usage.parameters.mix === 0
        ? ''
        : `colortemperature=temperature=${f(usage.parameters.kelvin)}:mix=${f(usage.parameters.mix)}:pl=1`;
    case 'GRAYSCALE':
      return 'hue=s=0';
    case 'SEPIA': {
      const intensity = usage.parameters.intensity,
        matrix = [
          [0.393, 0.769, 0.189],
          [0.349, 0.686, 0.168],
          [0.272, 0.534, 0.131],
        ],
        names = [
          ['rr', 'rg', 'rb'],
          ['gr', 'gg', 'gb'],
          ['br', 'bg', 'bb'],
        ];
      return (
        'colorchannelmixer=' +
        matrix
          .flatMap((row, i) =>
            row.map(
              (value, j) =>
                `${names[i][j]}=${f((i === j ? 1 : 0) * (1 - intensity) + value * intensity)}`,
            ),
          )
          .join(':')
      );
    }
    default:
      throw Error('Executor visual não registrado para o recurso.');
  }
}
