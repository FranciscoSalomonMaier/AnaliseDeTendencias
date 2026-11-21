import {
  AUDIO_SAMPLE_RATE,
  type AudioUsage,
  type AudioSourceMetadata,
} from './audio.schema';
export const audioSamples = (seconds: number) =>
  Math.round(seconds * AUDIO_SAMPLE_RATE);
export const audioSeconds = (samples: number) => samples / AUDIO_SAMPLE_RATE;
export function audioClipDuration(
  usage: Extract<
    AudioUsage,
    {
      resourceId:
        'ORIGINAL_AUDIO' | 'BACKGROUND_MUSIC' | 'SOUND_EFFECT' | 'NARRATION';
    }
  >,
  source: AudioSourceMetadata,
  total: number,
) {
  const p = usage.parameters,
    original = p.sourceEnd - p.sourceStart;
  if (p.sourceEnd > source.duration + 1e-6 || original < 1 / AUDIO_SAMPLE_RATE)
    throw Error('Intervalo fora da fonte de áudio.');
  if (usage.resourceId === 'ORIGINAL_AUDIO' && source.kind !== 'VIDEO')
    throw Error('ORIGINAL_AUDIO exige um vídeo com áudio.');
  const freeze =
    usage.resourceId === 'ORIGINAL_AUDIO' ? usage.parameters.freeze : 'NONE';
  const available =
    freeze === 'CONTINUE_SOURCE'
      ? source.duration - p.sourceStart
      : original / p.rate;
  if (p.rate !== 1 && original < 0.1)
    throw Error('Alteração de velocidade exige pelo menos 100 ms de origem.');
  const desired =
    (p.timelineEnd ?? p.timelineStart + available * p.repeat) - p.timelineStart;
  let repeats = p.repeat,
    output = available * repeats;
  if (freeze === 'SILENCE') output = desired;
  else if (freeze === 'CONTINUE_SOURCE') {
    if (desired > available + 1e-6)
      throw Error('Áudio ambiente insuficiente para o congelamento.');
    output = desired;
  } else if (p.endBehavior === 'LOOP') {
    repeats = Math.ceil(desired / available - 1e-9);
    if (repeats > 16) throw Error('Repetições de áudio excedidas.');
    output = desired;
  } else if (p.endBehavior === 'PAD_SILENCE') output = desired;
  else output = Math.min(output, desired);
  if (
    audioSamples(output) < 1 ||
    audioSamples(available) < 1 ||
    p.timelineStart + desired > total + 1e-6 ||
    p.fadeIn > output ||
    p.fadeOut > output
  )
    throw Error('Duração, posicionamento ou fades fora da composição.');
  return {
    available: audioSeconds(audioSamples(available)),
    duration: audioSeconds(audioSamples(output)),
    repeats,
    start: audioSeconds(audioSamples(p.timelineStart)),
    freeze,
  };
}

export function assertAlignedOriginalStreams(
  audioStart: unknown,
  videoStart: unknown,
) {
  const a = Number(audioStart ?? NaN),
    v = Number(videoStart ?? NaN);
  if (!Number.isFinite(a) || !Number.isFinite(v) || Math.abs(a - v) > 1 / 48000)
    throw Error(
      'Offsets originais diferentes ou desconhecidos exigem alinhamento explícito prévio.',
    );
}
