import {
  audioCompositionSchema,
  audioSourceMetadataSchema,
  parseAudioUsage,
  sourceAudioIds,
  AUDIO_SAMPLE_RATE,
  type AudioUsage,
  type AudioSourceMetadata,
} from './audio.schema';
import {
  audioClipDuration,
  audioSamples,
  audioSeconds,
} from './audio-duration';
import { easingProgress } from '../editing-resource.compiler';
const n = (value: number) => value.toFixed(8);
interface Track {
  label: string;
  duration: number;
  kind: string;
  gainBound: number;
}
/** Bounded technical audio timeline, not an editorial plan or a production job. */
export function compileAudioComposition(
  raw: unknown,
  sources: AudioSourceMetadata[],
) {
  sources = sources.map((s) => audioSourceMetadataSchema.parse(s));
  const plan = audioCompositionSchema.parse(raw),
    operations = plan.operations.map(parseAudioUsage),
    total = audioSeconds(audioSamples(plan.duration));
  if (
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    sources.length > 8
  )
    throw Error('Origens de áudio duplicadas ou excessivas.');
  const inputIds = [
      ...new Set(
        operations.flatMap((u) =>
          'sourceId' in u.parameters ? [u.parameters.sourceId] : [],
        ),
      ),
    ],
    graph: string[] = [],
    tracks = new Map<string, Track>(),
    clips = new Set<string>(),
    impacts: unknown[] = [],
    effectWindows: Array<{ start: number; end: number }> = [];
  let duckWindows = 0;
  let serial = 0,
    mixed = false,
    finalMix:
      | Extract<AudioUsage, { resourceId: 'AUDIO_MIX' }>['parameters']
      | undefined;
  const emit = (ins: string[], filter: string) => {
    const label = `a${serial++}`;
    graph.push(ins.map((s) => `[${s}]`).join('') + filter + `[${label}]`);
    return label;
  };
  const base =
    'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=N/SR/TB';
  const pad = (label: string, duration: number) =>
    emit(
      [label],
      `apad,atrim=end_sample=${audioSamples(duration)},asetpts=N/SR/TB`,
    );
  const repeat = (label: string, samples: number, count: number) => {
    if (count > 1 && samples > 90 * 48000)
      throw Error('Buffer de loop acima de 90 segundos.');
    return count > 1
      ? emit([label], `aloop=loop=${count - 1}:size=${samples},asetpts=N/SR/TB`)
      : label;
  };
  const processed = new Set<string>();
  for (const [index, u] of operations.entries()) {
    if (mixed) throw Error('AUDIO_MIX deve ser a última operação.');
    if (
      sourceAudioIds.includes(u.resourceId as (typeof sourceAudioIds)[number])
    ) {
      const sourceUsage = u as Extract<
          AudioUsage,
          { resourceId: (typeof sourceAudioIds)[number] }
        >,
        p = sourceUsage.parameters,
        source = sources.find((s) => s.id === p.sourceId);
      if (!source) throw Error('Fonte de áudio não encontrada.');
      if (clips.has(p.clipId) || clips.size >= 32)
        throw Error('Clipes duplicados ou acima de 32.');
      clips.add(p.clipId);
      if (processed.has(u.trackId))
        throw Error(
          'Declare todos os clipes de uma faixa antes de processá-la.',
        );
      const duration = audioClipDuration(sourceUsage, source, total);
      let label: string;
      if (duration.freeze === 'SILENCE')
        label = emit(
          [],
          `anullsrc=r=48000:cl=stereo,atrim=end_sample=${audioSamples(duration.duration)},asetpts=N/SR/TB`,
        );
      else {
        label = emit(
          [`${inputIds.indexOf(p.sourceId)}:a:0`],
          `${base},atrim=start_sample=${audioSamples(p.sourceStart)}:end_sample=${audioSamples(duration.freeze === 'CONTINUE_SOURCE' ? p.sourceStart + duration.duration : p.sourceEnd)},asetpts=N/SR/TB`,
        );
        let rate = p.rate;
        while (rate > 2) {
          label = emit([label], 'atempo=2');
          rate /= 2;
        }
        while (rate < 0.5) {
          label = emit([label], 'atempo=0.5');
          rate /= 0.5;
        }
        if (rate !== 1) label = emit([label], `atempo=${n(rate)}`);
        // atempo may drop a final analysis window; pad only this small decoder/filter tail, then trim explicitly.
        label = emit(
          [label],
          `apad=pad_dur=0.1,atrim=end_sample=${audioSamples(duration.available)},asetpts=N/SR/TB`,
        );
        label = repeat(
          label,
          audioSamples(duration.available),
          duration.repeats,
        );
        label = pad(label, duration.duration);
      }
      const fadeIn = p.fadeIn
          ? `,afade=t=in:st=0:d=${n(p.fadeIn)}:curve=tri`
          : '',
        fadeOut = p.fadeOut
          ? `,afade=t=out:st=${n(duration.duration - p.fadeOut)}:d=${n(p.fadeOut)}:curve=tri`
          : '';
      label = emit(
        [label],
        `volume=${n(p.mute ? 0 : p.gain)}${fadeIn}${fadeOut},adelay=${audioSamples(duration.start)}S:all=1`,
      );
      const end = duration.start + duration.duration,
        previous = tracks.get(u.trackId);
      if (previous) {
        if (previous.kind !== u.resourceId)
          throw Error('Uma faixa deve manter o mesmo tipo de fonte.');
        label = emit(
          [previous.label, label],
          'amix=inputs=2:duration=longest:dropout_transition=0:normalize=0',
        );
      }
      tracks.set(u.trackId, {
        label,
        duration: Math.max(previous?.duration ?? 0, end),
        kind: u.resourceId,
        gainBound: Math.max(previous?.gainBound ?? 0, p.mute ? 0 : p.gain),
      });
      if (tracks.size > 8) throw Error('Limite de oito faixas.');
      if (u.resourceId === 'SOUND_EFFECT')
        effectWindows.push({ start: duration.start, end });
      impacts.push({
        resourceId: u.resourceId,
        trackId: u.trackId,
        clipId: p.clipId,
        sourceSeconds: p.sourceEnd - p.sourceStart,
        outputSeconds: duration.duration,
        timelineStart: duration.start,
        repeats: duration.repeats,
        rate: p.rate,
        freeze: duration.freeze,
      });
      continue;
    }
    if (u.resourceId === 'AUDIO_MIX') {
      if (
        index !== operations.length - 1 ||
        u.parameters.trackIds.some((id) => !tracks.has(id))
      )
        throw Error('Mixagem exige faixas existentes e posição final.');
      if (tracks.size !== u.parameters.trackIds.length)
        throw Error(
          'A mixagem deve listar todas as faixas; silencie explicitamente as indesejadas.',
        );
      finalMix = u.parameters;
      mixed = true;
      continue;
    }
    const track = tracks.get(u.trackId);
    if (!track) throw Error('Faixa inexistente.');
    processed.add(u.trackId);
    switch (u.resourceId) {
      case 'AUDIO_VOLUME': {
        const q = u.parameters,
          end = q.end ?? total;
        if (end > total || q.start >= end)
          throw Error('Volume fora da composição.');
        const factor = q.mute ? 0 : Math.max(q.gain, q.endGain ?? q.gain),
          bound =
            track.gainBound *
            (q.start === 0 && end >= track.duration
              ? factor
              : Math.max(1, factor));
        if (bound > 4 + 1e-9)
          throw Error('Ganho acumulado de uma fonte excede 4.');
        track.gainBound = bound;
        const gain = q.mute
          ? '0'
          : q.endGain === undefined
            ? n(q.gain)
            : `${n(q.gain)}+(${n(q.endGain - q.gain)})*(${easingProgress(q.curve, `clip((t-${n(q.start)})/${n(end - q.start)},0,1)`)})`;
        track.label = emit(
          [track.label],
          `volume='if(gte(t,${n(q.start)})*lt(t,${n(end)}),${gain},1)':eval=frame`,
        );
        break;
      }
      case 'AUDIO_FADE_IN':
      case 'AUDIO_FADE_OUT': {
        const q = u.parameters;
        if (q.start + q.duration > track.duration + 1e-6)
          throw Error('Fade excede a faixa disponível.');
        const bound = track.gainBound * Math.max(q.fromGain, q.toGain);
        if (bound > 4 + 1e-9)
          throw Error('Ganho acumulado de uma fonte excede 4.');
        track.gainBound = bound;
        const curves = {
          LINEAR: 'tri',
          EASE_IN: 'qua',
          EASE_OUT: 'qsin',
          EASE_IN_OUT: 'hsin',
        };
        if (
          (q.fromGain === 0 &&
            q.toGain === 1 &&
            u.resourceId === 'AUDIO_FADE_IN') ||
          (q.fromGain === 1 &&
            q.toGain === 0 &&
            u.resourceId === 'AUDIO_FADE_OUT')
        )
          track.label = emit(
            [track.label],
            `afade=t=${u.resourceId === 'AUDIO_FADE_IN' ? 'in' : 'out'}:st=${n(q.start)}:d=${n(q.duration)}:curve=${curves[q.curve]}`,
          );
        else {
          const progress = easingProgress(
            q.curve,
            `clip((t-${n(q.start)})/${n(q.duration)},0,1)`,
          );
          track.label = emit(
            [track.label],
            `volume='${n(q.fromGain)}+(${n(q.toGain - q.fromGain)})*(${progress})':eval=frame`,
          );
        }
        break;
      }
      case 'AUDIO_DUCKING': {
        const q = u.parameters;
        duckWindows += q.intervals.length;
        if (duckWindows > 128) throw Error('Excesso de janelas de ducking.');
        if (
          q.triggerTrackId &&
          (!tracks.has(q.triggerTrackId) || q.triggerTrackId === u.trackId)
        )
          throw Error('Faixa de gatilho inválida.');
        const floor = Math.max(q.reduction, q.minimumGain);
        let expr = '1';
        for (const window of q.intervals) {
          if (window.end > total) throw Error('Ducking fora da composição.');
          const a = Math.max(0, window.start - q.attackSeconds),
            b = Math.min(total, window.end + q.releaseSeconds),
            attack =
              window.start > a
                ? `clip((t-${n(a)})/${n(window.start - a)},0,1)`
                : '1',
            release =
              b > window.end
                ? `clip((${n(b)}-t)/${n(b - window.end)},0,1)`
                : '1';
          const envelope = `if(lt(t,${n(window.start)}),${attack},if(lt(t,${n(window.end)}),1,${release}))`;
          const level = `if(between(t,${n(a)},${n(b)}),1-${n(1 - floor)}*(${envelope}),1)`;
          expr = `min(${expr},${level})`;
        }
        track.label = emit([track.label], `volume='${expr}':eval=frame`);
        break;
      }
      case 'AUDIO_LOOP': {
        const q = u.parameters,
          span = q.sourceEnd - q.sourceStart;
        if (
          audioSamples(q.sourceEnd) <= audioSamples(q.sourceStart) ||
          q.sourceEnd > track.duration + 1e-6 ||
          q.timelineStart + q.duration > total + 1e-6 ||
          (q.endBehavior === 'CUT' && q.duration > span * q.count + 1e-6)
        )
          throw Error('Loop excede a faixa, a quantidade ou a duração final.');
        let label = emit(
          [track.label],
          `atrim=start_sample=${audioSamples(q.sourceStart)}:end_sample=${audioSamples(q.sourceEnd)},asetpts=N/SR/TB`,
        );
        label = repeat(label, audioSamples(span), q.count);
        label = pad(label, q.duration);
        track.label = emit(
          [label],
          `adelay=${audioSamples(q.timelineStart)}S:all=1`,
        );
        track.duration = q.timelineStart + q.duration;
        break;
      }
    }
  }
  const windows = effectWindows
    .flatMap((w) => [
      { t: w.start, n: 1 },
      { t: w.end, n: -1 },
    ])
    .sort((a, b) => a.t - b.t || a.n - b.n);
  let live = 0;
  for (const w of windows) {
    live += w.n;
    if (live > 8) throw Error('Mais de oito efeitos simultâneos.');
  }
  let labels = [...tracks.values()].map((t) => pad(t.label, total));
  if (!labels.length)
    labels = [
      emit(
        [],
        `anullsrc=r=48000:cl=stereo,atrim=end_sample=${audioSamples(total)},asetpts=N/SR/TB`,
      ),
    ];
  const ordered = finalMix
    ? finalMix.trackIds.map((id) => {
        const keys = [...tracks.keys()];
        return labels[keys.indexOf(id)];
      })
    : labels;
  let output =
    ordered.length > 1
      ? emit(
          ordered,
          `amix=inputs=${ordered.length}:duration=longest:dropout_transition=0:normalize=0`,
        )
      : ordered[0];
  if (finalMix) {
    output = emit([output], `volume=${n(finalMix.gain)}`);
    if (finalMix.limiter)
      output = emit(
        [output],
        `alimiter=limit=${n(finalMix.peakLimit)}:level=0:attack=5:release=50:latency=1`,
      );
  }
  output = emit(
    [output],
    `apad,atrim=end_sample=${audioSamples(total)},asetpts=N/SR/TB,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
  );
  if (graph.join(';').length > 100000)
    throw Error('Grafo de áudio acima do limite técnico.');
  return {
    filterGraph: graph.join(';'),
    outputLabel: output,
    inputIds,
    duration: total,
    samples: audioSamples(total),
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: 2,
    impacts,
    tracks: [...tracks.keys()],
    limiter: finalMix?.limiter ?? false,
  };
}
