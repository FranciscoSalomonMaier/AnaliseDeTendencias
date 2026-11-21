import {
  audioParameterSchemas,
  type AudioResourceId,
} from './audio/audio.schema';
import {
  audioRequiredFilters,
  audioResourceFilters,
} from './audio/audio.resources';
import { graphicsParameterSchemas } from './graphics/graphics.schema';
import { z } from 'zod';
import { resourceParameterSchemas } from './definitions/visual.resources';
import {
  resourceCategorySchema,
  resourceScopeSchema,
  resourceIdSchema,
} from './editing-resource.schema';
import type { ResourceDefinition } from './editing-resource.types';
export type { ResourceUsage } from './editing-resource.schema';
export type ResourceCategory = z.infer<typeof resourceCategorySchema>;
export type ResourceScope = z.infer<typeof resourceScopeSchema>;
const definitionSchema = z
  .object({
    id: resourceIdSchema,
    version: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().min(1),
    category: resourceCategorySchema,
    scopes: z.array(resourceScopeSchema).min(1),
    implemented: z.boolean(),
    changesDuration: z.boolean(),
    requiredFilters: z.array(z.string().min(1)),
    restrictions: z.array(z.string().min(1)),
    legacyImplementation: z.string().optional(),
    parametersSchema: z
      .custom<z.ZodType>((v) => v instanceof z.ZodType)
      .nullable(),
  })
  .strict();
const rows: Array<
  [
    keyof typeof resourceParameterSchemas,
    string,
    string,
    ResourceCategory,
    ResourceScope[],
    boolean,
    string[],
  ]
> = [
  [
    'CUT',
    'Recorte temporal',
    'Recorta um intervalo em segundos do arquivo original.',
    'VIDEO_MANIPULATION',
    ['SOURCE_INTERVAL'],
    true,
    [],
  ],
  [
    'CONCAT',
    'Concatenar trechos',
    'Combina trechos na ordem informada, normalizados para a composição.',
    'VIDEO_MANIPULATION',
    ['COMPOSITION'],
    true,
    ['concat'],
  ],
  [
    'SPEED_CHANGE',
    'Velocidade de reprodução',
    'Altera a velocidade no intervalo indicado, preservando o restante do trecho.',
    'VIDEO_MANIPULATION',
    ['CLIP', 'CLIP_INTERVAL'],
    true,
    ['setpts'],
  ],
  [
    'FREEZE_FRAME',
    'Congelar frame',
    'Produz um novo trecho estático a partir de um instante do trecho processado.',
    'VIDEO_MANIPULATION',
    ['CLIP'],
    true,
    ['loop'],
  ],
  [
    'REPEAT_SEGMENT',
    'Repetir intervalo',
    'Reproduz um intervalo um número finito de vezes, preservando prefixo e sufixo.',
    'VIDEO_MANIPULATION',
    ['CLIP', 'CLIP_INTERVAL'],
    true,
    ['split', 'concat'],
  ],
  [
    'RESIZE',
    'Redimensionar',
    'Redimensiona a camada antes do enquadramento final, com proporção opcionalmente preservada.',
    'COMPOSITION',
    ['COMPOSITION'],
    false,
    ['scale'],
  ],
  [
    'CROP',
    'Recorte espacial',
    'Seleciona uma região relativa do trecho, sem alterar o tempo.',
    'COMPOSITION',
    ['COMPOSITION'],
    false,
    ['crop'],
  ],
  [
    'POSITION',
    'Posicionamento',
    'Alinha na área livre: 0 é início, 0,5 é centro e 1 é fim de cada eixo.',
    'COMPOSITION',
    ['COMPOSITION'],
    false,
    ['pad'],
  ],
  [
    'FIT',
    'Ajustar proporcionalmente',
    'Mantém todo o conteúdo dentro da área proporcional especificada, com fundo.',
    'COMPOSITION',
    ['COMPOSITION'],
    false,
    ['scale', 'pad'],
  ],
  [
    'FILL',
    'Preencher área',
    'Preenche a área proporcional especificada, recortando as sobras sem deformar.',
    'COMPOSITION',
    ['COMPOSITION'],
    false,
    ['scale', 'crop'],
  ],
  [
    'SOLID_BACKGROUND',
    'Fundo sólido',
    'Define a cor do fundo; mantém o conteúdo proporcionalmente visível.',
    'COMPOSITION',
    ['COMPOSITION'],
    false,
    ['pad'],
  ],
  [
    'BLUR_BACKGROUND',
    'Fundo desfocado',
    'Cópia ampliada e desfocada do vídeo atrás da camada nítida.',
    'COMPOSITION',
    ['COMPOSITION'],
    false,
    ['split', 'overlay', 'gblur'],
  ],
  [
    'STATIC_ZOOM',
    'Zoom fixo',
    'Ampliação com foco relativo e recorte limitado às bordas da composição.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['zoompan'],
  ],
  [
    'DYNAMIC_ZOOM',
    'Zoom progressivo',
    'Interpola a ampliação durante o intervalo, com foco e curva de movimento.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['zoompan'],
  ],
  [
    'CAMERA_SHAKE',
    'Tremor de câmera',
    'Oscilação determinística com margem ampliada para ocultar bordas.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['scale', 'crop'],
  ],
  [
    'MOTION_BLUR',
    'Desfoque de movimento',
    'Aproximação por média temporal de até cinco frames; pode produzir rastros, sem fluxo óptico.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['tmix'],
  ],
  [
    'GAUSSIAN_BLUR',
    'Desfoque gaussiano',
    'Desfoque espacial do trecho ou intervalo selecionado.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['gblur'],
  ],
  [
    'VIGNETTE',
    'Vinheta',
    'Escurece as extremidades, com intensidade controlada.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['vignette'],
  ],
  [
    'FILM_GRAIN',
    'Granulação',
    'Ruído visual espacial ou temporal, reproduzível por seed.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['noise'],
  ],
  [
    'GLITCH',
    'Distorção de canais',
    'Desloca canais RGB em pulsos temporários determinísticos; variante inicial simples.',
    'VISUAL_EFFECT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['rgbashift'],
  ],
  [
    'HARD_CUT',
    'Corte seco',
    'Une dois trechos sem sobreposição.',
    'TRANSITION',
    ['BETWEEN_CLIPS'],
    true,
    ['concat'],
  ],
  [
    'FADE_IN',
    'Entrada gradual',
    'Revela o intervalo a partir da cor escolhida, inclusive no meio do vídeo.',
    'TRANSITION',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['fade'],
  ],
  [
    'FADE_OUT',
    'Saída gradual',
    'Oculta o fim do intervalo na cor escolhida, inclusive no meio do vídeo.',
    'TRANSITION',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['fade'],
  ],
  [
    'CROSSFADE',
    'Dissolução',
    'Sobrepõe dois trechos; a duração diminui pela sobreposição.',
    'TRANSITION',
    ['BETWEEN_CLIPS'],
    true,
    ['xfade'],
  ],
  [
    'ZOOM_TRANSITION',
    'Transição por aproximação',
    'Sobrepõe trechos com zoomin; diferente do zoom dentro de uma cena.',
    'TRANSITION',
    ['BETWEEN_CLIPS'],
    true,
    ['xfade'],
  ],
  [
    'SLIDE_TRANSITION',
    'Transição por deslocamento',
    'Sobreposição com movimento para esquerda, direita, cima ou baixo.',
    'TRANSITION',
    ['BETWEEN_CLIPS'],
    true,
    ['xfade'],
  ],
  [
    'BRIGHTNESS',
    'Brilho',
    'Ajuste aditivo de luminância.',
    'COLOR_ADJUSTMENT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['eq'],
  ],
  [
    'CONTRAST',
    'Contraste',
    'Ajuste multiplicativo de contraste.',
    'COLOR_ADJUSTMENT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['eq'],
  ],
  [
    'SATURATION',
    'Saturação',
    'Ajuste multiplicativo de saturação.',
    'COLOR_ADJUSTMENT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['eq'],
  ],
  [
    'GAMMA',
    'Gamma',
    'Ajusta a curva de luminância.',
    'COLOR_ADJUSTMENT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['eq'],
  ],
  [
    'COLOR_TEMPERATURE',
    'Temperatura de cor',
    'Ajusta a temperatura em Kelvin, com mistura controlada.',
    'COLOR_ADJUSTMENT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['colortemperature'],
  ],
  [
    'GRAYSCALE',
    'Escala de cinza',
    'Remove a saturação.',
    'COLOR_ADJUSTMENT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['hue'],
  ],
  [
    'SEPIA',
    'Sépia',
    'Interpola a matriz RGB neutra e a matriz sépia.',
    'COLOR_ADJUSTMENT',
    ['CLIP', 'CLIP_INTERVAL'],
    false,
    ['colorchannelmixer'],
  ],
];
const legacy: Partial<Record<keyof typeof resourceParameterSchemas, string>> = {
  CUT: 'ShortMedia.render: -ss/-t e validação de intervalos.',
  CONCAT: 'ShortMedia.render: concatenação ordenada.',
  FIT: 'prepareRenderImage e RemixAssemblyRenderer: ajuste proporcional.',
  FILL: 'ShortMedia.render e framingGraph: scale/crop.',
  BLUR_BACKGROUND:
    'ShortMedia.render e framingGraph: split/scale/blur/overlay.',
  DYNAMIC_ZOOM:
    'imageMotionFilter e ShortMedia.render: interpolação por frames.',
  HARD_CUT: 'ShortMedia.render e RemixAssemblyRenderer: concatenação.',
  FADE_IN: 'ShortMedia.render: fade inicial.',
  FADE_OUT: 'ShortMedia.render: fade final.',
  CROSSFADE:
    'sceneVideoGraph: xfade; o adaptador novo calcula sobreposição real.',
  SPEED_CHANGE: 'RemixAssemblyRenderer: setpts.',
  FREEZE_FRAME: 'RemixAssemblyRenderer: tpad clone.',
};
const resourceRestrictions: Partial<
  Record<keyof typeof resourceParameterSchemas, string[]>
> = {
  CROP: [
    'A soma de posição e tamanho de cada eixo deve permanecer dentro da imagem.',
  ],
  RESIZE: [
    'Dimensões pares; a área intermediária não pode exceder a área máxima da composição de produção.',
  ],
  FREEZE_FRAME: [
    'O instante é relativo ao trecho processado e deve preceder seu término. O resultado substitui o trecho por uma imagem estática.',
  ],
  FADE_IN: ['A duração do fade não pode exceder o intervalo de aplicação.'],
  FADE_OUT: ['A duração do fade não pode exceder o intervalo de aplicação.'],
  CROSSFADE: ['A sobreposição deve ser menor que ambos os trechos.'],
  SLIDE_TRANSITION: ['A sobreposição deve ser menor que ambos os trechos.'],
  ZOOM_TRANSITION: [
    'Variante inicial por aproximação (zoomin); afastamento entre cenas ainda não é oferecido.',
    'A sobreposição deve ser menor que ambos os trechos.',
  ],
};
const visual: ResourceDefinition[] = rows.map(
  ([
    id,
    name,
    description,
    category,
    scopes,
    changesDuration,
    requiredFilters,
  ]) => ({
    id,
    version: 1,
    name,
    description,
    category,
    scopes,
    implemented: true,
    changesDuration,
    requiredFilters,
    parametersSchema: resourceParameterSchemas[id],
    restrictions: [
      ...(resourceRestrictions[id] ?? []),
      'Execução visual sem áudio; a transformação temporal deverá ser aplicada ao áudio em etapa posterior.',
      'Até 12 operações locais, oito origens e 90 segundos de resultado a 30 FPS.',
      'Tempos do trecho referem-se à saída da operação anterior; composição final vertical 9:16.',
    ],
    ...(legacy[id] ? { legacyImplementation: legacy[id] } : {}),
  }),
);
const futureText = [
  'FIXED_TITLE',
  'TEMPORARY_TEXT',
  'STYLED_TEXT',
  'CAPTIONS',
  'WORD_HIGHLIGHT',
  'EMOJI',
  'IMAGE_OVERLAY',
  'LOGO',
  'WATERMARK',
  'RANKING_PANEL',
  'RANKING_REVEAL',
  'TEXT_ANIMATION',
];
const futureAudio = [
  'ORIGINAL_AUDIO',
  'BACKGROUND_MUSIC',
  'SOUND_EFFECT',
  'NARRATION',
  'AUDIO_VOLUME',
  'AUDIO_FADE_IN',
  'AUDIO_FADE_OUT',
  'AUDIO_DUCKING',
  'AUDIO_LOOP',
  'AUDIO_MIX',
];
const futureNames: Record<string, string> = {
  FIXED_TITLE: 'Título fixo',
  TEMPORARY_TEXT: 'Texto temporário',
  STYLED_TEXT: 'Texto estilizado',
  CAPTIONS: 'Legendas',
  WORD_HIGHLIGHT: 'Destaque de palavra',
  EMOJI: 'Emoji',
  IMAGE_OVERLAY: 'Imagem sobreposta',
  LOGO: 'Logo',
  WATERMARK: 'Marca d’água',
  RANKING_PANEL: 'Painel de ranking',
  RANKING_REVEAL: 'Revelação de ranking',
  TEXT_ANIMATION: 'Animação de texto',
  ORIGINAL_AUDIO: 'Áudio original',
  BACKGROUND_MUSIC: 'Música de fundo',
  SOUND_EFFECT: 'Efeito sonoro',
  NARRATION: 'Narração',
  AUDIO_VOLUME: 'Volume',
  AUDIO_FADE_IN: 'Entrada de áudio',
  AUDIO_FADE_OUT: 'Saída de áudio',
  AUDIO_DUCKING: 'Ducking',
  AUDIO_LOOP: 'Repetição de áudio',
  AUDIO_MIX: 'Mixagem',
};
const graphics: ResourceDefinition[] = futureText.map((id) => ({
  id,
  version: 1,
  name: futureNames[id],
  description:
    'Recurso gráfico isolado, validado e composto após os efeitos do vídeo.',
  category: 'TEXT_AND_GRAPHICS',
  scopes: ['COMPOSITION'],
  implemented: true,
  changesDuration: false,
  requiredFilters: ['overlay', 'colorchannelmixer', 'geq'],
  parametersSchema:
    graphicsParameterSchemas[id as keyof typeof graphicsParameterSchemas],
  restrictions: [
    'Coordenadas relativas à composição final; relógio final após transformações de vídeo. Não sincroniza automaticamente gráficos a recortes ou mudanças de velocidade.',
    'Até 160 elementos, 32 simultâneos, 120 legendas, 160 palavras, 20 posições, 64 animações, 20000 caracteres processados e 32 telas de texturas.',
    'Camadas ordenadas por layer e ordem de declaração; efeitos visuais são aplicados antes dos gráficos. Intervalos [start,end).',
    'Fontes e emojis locais versionados. Caracteres sem glifos e imagens não autorizadas são rejeitados.',
    'Margens seguras estimadas e configuráveis; autorizar explicitamente posicionamento fora delas.',
    'TYPEWRITER: uma linha, um segmento, até 80 grafemas; até quatro animações por elemento. Rankings mantêm slots fixos, sem rotação.',
    'Áudio ausente; nenhum vínculo com jobs ou produção.',
  ],
  legacyImplementation:
    'Sharp existente para rasterização; ASS/SRT e renderizadores legados preservados. Dados sincronizados fornecidos pelo chamador.',
}));
const audio: ResourceDefinition[] = futureAudio.map((id) => ({
  id,
  version: 1,
  name: futureNames[id],
  description:
    'Operação de áudio isolada, com fontes e relógios explícitos, sem narração obrigatória.',
  category: 'AUDIO',
  scopes: ['COMPOSITION'],
  implemented: true,
  changesDuration: id === 'AUDIO_LOOP',
  requiredFilters: [
    ...audioRequiredFilters,
    ...audioResourceFilters[id as AudioResourceId],
  ],
  parametersSchema: audioParameterSchemas[id as AudioResourceId],
  legacyImplementation:
    'ShortMusicValidator, MediaProcess, RemixVideoValidator e padrões de AudioMixService; produção inalterada.',
  restrictions: [
    'Executado por AudioResourceExecutor. Target COMPOSITION.clipId identifica a faixa lógica; AUDIO_MIX usa a saída lógica.',
    'Fontes originais usam segundos da fonte; timelineStart usa segundos da composição final. Intervalos de operações usam a faixa já processada.',
    'Até oito fontes/faixas, 32 clipes, oito efeitos simultâneos, 64 operações, 16 repetições e 90 segundos.',
    'Ganho linear entre 0 e 4; neutro 1, mute 0. AUDIO_MIX.gain limitado a 1. Sem loudness automático; limiter apenas explicitamente solicitado.',
    'Ducking KNOWN_INTERVALS: redução linear e rampas de ataque/recuperação; sem sidechain por sinal nesta versão.',
    'Loop finito, sem crossfade entre ciclos. Crossfades sonoros exigem sobreposição e fades explícitos.',
    'Congele com SILENCE ou CONTINUE_SOURCE explícitos. Não há tradução automática de planos visuais. Original usa apenas a primeira faixa sonora e rejeita offsets entre streams.',
    'Declare clipes de uma faixa antes de suas operações; AUDIO_MIX deve listar todas as faixas e aparecer por último.',
    'Saída WAV PCM 48 kHz estéreo ou MP4 H.264 copiado/AAC 48 kHz; NO_STREAM apenas para vídeo sem operações de áudio.',
  ],
}));
export function defineResourceRegistry(
  input: readonly ResourceDefinition[],
): readonly ResourceDefinition[] {
  const parsed = input.map((item) => definitionSchema.parse(item));
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length)
    throw Error('Identificadores de recursos duplicados.');
  for (const item of parsed) {
    if (item.implemented && !item.parametersSchema)
      throw Error('Recurso implementado sem contrato.');
    Object.freeze(item.scopes);
    Object.freeze(item.requiredFilters);
    Object.freeze(item.restrictions);
    Object.freeze(item);
  }
  return Object.freeze(parsed);
}
export const editingResourceRegistry = defineResourceRegistry([
  ...visual,
  ...graphics,
  ...audio,
]);
export function getResourceDefinition(id: string) {
  const item = editingResourceRegistry.find((item) => item.id === id);
  if (!item) throw Error('Recurso de edição inexistente.');
  return item;
}
