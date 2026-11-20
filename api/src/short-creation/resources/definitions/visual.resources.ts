import { z } from 'zod';
const number = (min: number, max: number, value: number, unit: string) =>
  z.number().finite().min(min).max(max).default(value).describe(unit);
const fraction = (value: number) =>
  number(0, 1, value, 'Fração normalizada (0–1).');
const dimensions = {
  width: z
    .number()
    .int()
    .min(2)
    .max(1920)
    .describe('Largura intermediária em pixels; deve ser par.'),
  height: z
    .number()
    .int()
    .min(2)
    .max(1920)
    .describe('Altura intermediária em pixels; deve ser par.'),
  preserveAspect: z.boolean().default(true),
};
const area = {
  widthFraction: number(0.1, 1, 1, 'Fração da largura da composição.'),
  heightFraction: number(0.1, 1, 1, 'Fração da altura da composição.'),
};
const focus = { focusX: fraction(0.5), focusY: fraction(0.5) };
const duration = () =>
  number(
    1 / 30,
    2,
    0.3,
    'Segundos, quantizados a 30 FPS; menor que ambos os trechos nas transições.',
  );
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .default('#000000')
  .describe('Cor RGB hexadecimal #RRGGBB.');
const empty = () => z.object({}).strict();
export const resourceParameterSchemas = {
  CUT: empty(),
  CONCAT: empty(),
  SPEED_CHANGE: z
    .object({
      factor: number(0.25, 4, 1, 'Fator de reprodução: 0,25x–4x; 1 é neutro.'),
    })
    .strict(),
  FREEZE_FRAME: z
    .object({
      at: number(
        0,
        600,
        0,
        'Segundo relativo ao trecho processado, anterior ao seu término.',
      ),
      duration: number(
        1 / 30,
        5,
        1,
        'Duração resultante do trecho estático, em segundos.',
      ),
    })
    .strict(),
  REPEAT_SEGMENT: z
    .object({
      count: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(2)
        .describe(
          'Quantidade total de reproduções do intervalo, incluindo a primeira.',
        ),
    })
    .strict(),
  RESIZE: z
    .object(dimensions)
    .strict()
    .refine(
      (v) =>
        v.width % 2 === 0 &&
        v.height % 2 === 0 &&
        v.width * v.height <= 1080 * 1920,
      'Dimensões pares e até 2.073.600 pixels.',
    ),
  CROP: z
    .object({
      x: fraction(0),
      y: fraction(0),
      widthFraction: number(0.1, 1, 1, 'Fração da largura do trecho.'),
      heightFraction: number(0.1, 1, 1, 'Fração da altura do trecho.'),
    })
    .strict()
    .refine(
      (v) =>
        v.x + v.widthFraction <= 1.000001 && v.y + v.heightFraction <= 1.000001,
      'O recorte deve ficar dentro da imagem.',
    ),
  POSITION: z.object({ x: fraction(0.5), y: fraction(0.5) }).strict(),
  FIT: z.object(area).strict(),
  FILL: z.object(area).strict(),
  SOLID_BACKGROUND: z.object({ color }).strict(),
  BLUR_BACKGROUND: z
    .object({
      sigma: number(
        1,
        20,
        10,
        'Sigma do desfoque gaussiano, em pixels da composição.',
      ),
    })
    .strict(),
  STATIC_ZOOM: z
    .object({
      scale: number(1, 2.5, 1.2, 'Ampliação fixa; 1 é neutro.'),
      ...focus,
    })
    .strict(),
  DYNAMIC_ZOOM: z
    .object({
      startScale: number(1, 2.5, 1, 'Ampliação inicial.'),
      endScale: number(1, 2.5, 1.2, 'Ampliação final.'),
      ...focus,
      easing: z
        .enum(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'])
        .default('LINEAR'),
    })
    .strict(),
  CAMERA_SHAKE: z
    .object({
      intensity: number(
        0,
        0.05,
        0.02,
        'Margem máxima de movimento relativa à composição (até 5%).',
      ),
      frequency: number(0.5, 12, 5, 'Frequência em Hz.'),
      horizontal: z.boolean().default(true),
      vertical: z.boolean().default(true),
      seed: z.number().int().min(0).max(2147483647).default(1),
    })
    .strict(),
  MOTION_BLUR: z.object({ intensity: fraction(0.5) }).strict(),
  GAUSSIAN_BLUR: z
    .object({
      sigma: number(0, 20, 3, 'Sigma espacial em pixels; zero é neutro.'),
    })
    .strict(),
  VIGNETTE: z.object({ intensity: fraction(0.5) }).strict(),
  FILM_GRAIN: z
    .object({
      intensity: number(0, 20, 5, 'Força de ruído FFmpeg (0–20).'),
      temporal: z.boolean().default(true),
      seed: z.number().int().min(0).max(2147483647).default(1),
    })
    .strict(),
  GLITCH: z
    .object({
      intensity: number(
        0,
        0.03,
        0.015,
        'Deslocamento relativo dos canais de cor (até 3% da largura).',
      ),
      frequency: number(0.5, 10, 3, 'Pulsos por segundo.'),
      dutyCycle: number(
        0.05,
        0.5,
        0.25,
        'Fração de cada pulso em que o efeito fica ativo.',
      ),
    })
    .strict(),
  HARD_CUT: empty(),
  FADE_IN: z.object({ duration: duration(), color }).strict(),
  FADE_OUT: z.object({ duration: duration(), color }).strict(),
  CROSSFADE: z.object({ duration: duration() }).strict(),
  ZOOM_TRANSITION: z.object({ duration: duration() }).strict(),
  SLIDE_TRANSITION: z
    .object({
      duration: duration(),
      direction: z.enum(['LEFT', 'RIGHT', 'UP', 'DOWN']).default('LEFT'),
    })
    .strict(),
  BRIGHTNESS: z
    .object({
      value: number(
        -0.5,
        0.5,
        0,
        'Ajuste aditivo de luminância; zero é neutro.',
      ),
    })
    .strict(),
  CONTRAST: z
    .object({
      value: number(0.25, 2, 1, 'Multiplicador de contraste; 1 é neutro.'),
    })
    .strict(),
  SATURATION: z
    .object({
      value: number(
        0,
        2,
        1,
        'Multiplicador de saturação; 1 é neutro, zero dessatura.',
      ),
    })
    .strict(),
  GAMMA: z.object({ value: number(0.5, 2, 1, 'Gamma; 1 é neutro.') }).strict(),
  COLOR_TEMPERATURE: z
    .object({
      kelvin: number(
        2000,
        10000,
        6500,
        'Temperatura em Kelvin; 6500 é o ponto neutro desta biblioteca.',
      ),
      mix: fraction(1),
    })
    .strict(),
  GRAYSCALE: empty(),
  SEPIA: z.object({ intensity: fraction(1) }).strict(),
} as const;
export type ImplementedResourceId = keyof typeof resourceParameterSchemas;
