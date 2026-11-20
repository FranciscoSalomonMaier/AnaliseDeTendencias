import type {
  ValidatedResourceUsage,
  DurationImpact,
} from './editing-resource.types';
export const RESOURCE_FPS = 30;
export const toFrames = (seconds: number) => Math.round(seconds * RESOURCE_FPS);
export const toSeconds = (frames: number) => frames / RESOURCE_FPS;
export function resourceInterval(
  usage: ValidatedResourceUsage,
  inputFrames: number,
) {
  const t = usage.target;
  if (!('start' in t)) return { start: 0, end: inputFrames };
  if (t.start < 0 || t.end > toSeconds(inputFrames) + 0.000001)
    throw Error(
      'Intervalo fora dos limites da origem ou do trecho processado.',
    );
  const start = toFrames(t.start),
    end = toFrames(t.end);
  if (end <= start) throw Error('O intervalo deve conter ao menos um frame.');
  return { start, end };
}
export function resourceDuration(
  usage: ValidatedResourceUsage,
  inputDurations: number[],
): DurationImpact {
  if (
    !inputDurations.length ||
    inputDurations.some((d) => !Number.isFinite(d) || d <= 0)
  )
    throw Error('Duração de entrada inválida.');
  if (
    usage.resourceId === 'CUT' &&
    usage.target.scope === 'SOURCE_INTERVAL' &&
    usage.target.end > inputDurations[0] + 0.000001
  )
    throw Error('Intervalo fora dos limites do arquivo original.');
  const lengths = inputDurations.map(toFrames),
    sum = lengths.reduce((n, d) => n + d, 0),
    interval = resourceInterval(usage, lengths[0]),
    selected = interval.end - interval.start;
  let output = sum,
    overlap = 0,
    minimum = 1,
    requirement =
      'Preservar o tempo; sincronização e mixagem de áudio não são executadas.';
  switch (usage.resourceId) {
    case 'CUT':
      output = selected;
      requirement = 'Recortar o áudio no mesmo intervalo do arquivo original.';
      break;
    case 'SPEED_CHANGE':
      output =
        lengths[0] -
        selected +
        Math.max(1, Math.round(selected / usage.parameters.factor));
      requirement = `Aplicar fator ${usage.parameters.factor} ao áudio do intervalo e reposicionar o sufixo.`;
      break;
    case 'FREEZE_FRAME':
      if (usage.parameters.at >= toSeconds(lengths[0]))
        throw Error('O instante congelado deve estar dentro do trecho.');
      output = Math.max(1, toFrames(usage.parameters.duration));
      requirement =
        'Definir silêncio, sustentação ou outro tratamento para o trecho estático; não copiar áudio arbitrariamente.';
      break;
    case 'REPEAT_SEGMENT':
      output = lengths[0] + selected * (usage.parameters.count - 1);
      requirement =
        'Repetir o mesmo intervalo do áudio e reposicionar o sufixo.';
      break;
    case 'CROSSFADE':
    case 'ZOOM_TRANSITION':
    case 'SLIDE_TRANSITION':
      if (lengths.length !== 2)
        throw Error('A transição requer exatamente dois trechos.');
      overlap = toFrames(usage.parameters.duration);
      minimum = overlap + 1;
      if (overlap < 1 || lengths.some((d) => d <= overlap))
        throw Error('A sobreposição deve ser menor que ambos os trechos.');
      output = sum - overlap;
      requirement =
        'Sobrepor o áudio pelo mesmo intervalo antes de definir a futura curva de mixagem.';
      break;
    case 'FADE_IN':
    case 'FADE_OUT':
      if (toFrames(usage.parameters.duration) > selected)
        throw Error('O fade excede o intervalo.');
      break;
  }
  if (output < 1 || output > 90 * RESOURCE_FPS)
    throw Error('A operação deve produzir entre um frame e 90 segundos.');
  return {
    inputSeconds: toSeconds(sum),
    outputSeconds: toSeconds(output),
    deltaSeconds: toSeconds(output - sum),
    overlapSeconds: toSeconds(overlap),
    minimumInputSeconds: toSeconds(minimum),
    roundingToleranceSeconds: 1 / RESOURCE_FPS,
    audioRequirement: requirement,
  };
}

/** Planner-facing equations, without a timeline or concrete decisions. */
export function resourceDurationModel(id: string) {
  const equations: Record<string, string> = {
    CUT: 'end - start',
    CONCAT: 'sum(inputs)',
    HARD_CUT: 'first + second',
    SPEED_CHANGE: 'prefix + interval / factor + suffix',
    FREEZE_FRAME: 'parameters.duration',
    REPEAT_SEGMENT: 'prefix + interval * count + suffix',
    CROSSFADE: 'first + second - overlap',
    ZOOM_TRANSITION: 'first + second - overlap',
    SLIDE_TRANSITION: 'first + second - overlap',
  };
  return {
    unit: 'SECONDS',
    clock: id === 'CUT' ? 'ORIGINAL_SOURCE' : 'CURRENT_PROCESSED_CLIP',
    outputEquation: equations[id] ?? 'input',
    maximumOutputSeconds: 90,
    rounding: 'NEAREST_FRAME',
    fps: RESOURCE_FPS,
    toleranceSeconds: 1 / RESOURCE_FPS,
    audioExecution: false,
  };
}
