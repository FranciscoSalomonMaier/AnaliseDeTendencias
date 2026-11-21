import { easingProgress } from '../editing-resource.compiler';
import type { PreparedGraphic } from './graphics-renderer';
const f = (n: number) => n.toFixed(6);
/** Internal expressions only: all inputs are numeric or validated enum values. */
export function appendGraphicsGraph(
  base: {
    filterGraph: string;
    outputLabel: string;
    inputIds: string[];
    width: number;
    height: number;
  },
  elements: PreparedGraphic[],
) {
  const filters = [base.filterGraph];
  let output = base.outputLabel;
  elements.forEach((e, i) => {
    let label = `g${i}`,
      x = f(e.x),
      y = f(e.y),
      size = '1';
    const transforms = [`format=rgba`, `colorchannelmixer=aa=${f(e.opacity)}`];
    for (const a of e.animations) {
      const start = e.start + a.at,
        end = start + a.duration * a.repetitions;
      const raw = `clip((t-${f(start)})/${f(a.duration)},0,1)`,
        progress = easingProgress(a.curve, raw),
        active = `between(t,${f(start)},${f(end)})`,
        period = `(t-${f(start)})/${f(a.duration)}`;
      switch (a.type) {
        case 'NONE':
          break;
        case 'FADE_IN':
        case 'FADE_OUT': {
          // Arbitrary opacity endpoints are rendered by an alpha expression, not a black fade.
          const from = a.opacityFrom,
            to = a.opacityTo;
          const alpha =
            a.type === 'FADE_IN'
              ? `${f(from)}+(${f(to - from)})*(${progress})`
              : `${f(to)}-(${f(to - from)})*(${progress})`;
          transforms.push(
            `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${alpha.replace(/\bt\b/g, 'T')})'`,
          );
          break;
        }
        case 'SLIDE_IN':
        case 'SLIDE_OUT': {
          const axis = ['LEFT', 'RIGHT'].includes(a.direction) ? 'x' : 'y',
            sign = ['LEFT', 'UP'].includes(a.direction) ? -1 : 1,
            amount = (axis === 'x' ? base.width : base.height) * a.intensity;
          const offset = `${f(sign * amount)}*(${a.type === 'SLIDE_IN' ? `1-(${progress})` : progress})`;
          if (axis === 'x') x += `+(${offset})`;
          else y += `+(${offset})`;
          break;
        }
        case 'SCALE_IN':
          size = `${f(a.scaleFrom)}+(${f(a.scaleTo - a.scaleFrom)})*(${progress})`;
          break;
        case 'SCALE_OUT':
          size = `${f(a.scaleTo)}-(${f(a.scaleTo - a.scaleFrom)})*(${progress})`;
          break;
        case 'POP':
          size = `1+${f(a.intensity)}*sin(PI*(${progress}))`;
          break;
        case 'BOUNCE':
          y += `-${f(a.intensity * base.height * 0.08)}*abs(sin(PI*${period}))*(${active})`;
          break;
        case 'SHAKE':
          x += `+${f(a.intensity * base.width * 0.025)}*sin(12*PI*${period})*(${active})`;
          break;
        case 'PULSE':
          size = `1+${f(a.intensity * 0.2)}*sin(2*PI*${period})*(${active})`;
          break;
        case 'TYPEWRITER':
          throw Error('TYPEWRITER deve ser rasterizado em estados temporais.');
      }
    }
    if (size !== '1') {
      transforms.push(
        `scale=w='max(2,round(iw*(${size})))':h='max(2,round(ih*(${size})))':eval=frame`,
      );
      x += `+(${e.width}-overlay_w)/2`;
      y += `+(${e.height}-overlay_h)/2`;
    }
    filters.push(
      `[${base.inputIds.length + i}:v]${transforms.join(',')}[${label}]`,
    );
    const next = `graphicout${i}`;
    filters.push(
      `[${output}][${label}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:repeatlast=0:enable='gte(t,${f(e.start)})*lt(t,${f(e.end)})'[${next}]`,
    );
    output = next;
  });
  if (elements.length) {
    filters.push(`[${output}]format=yuv420p[graphicsfinal]`);
    output = 'graphicsfinal';
  }
  return { filterGraph: filters.join(';'), outputLabel: output };
}
