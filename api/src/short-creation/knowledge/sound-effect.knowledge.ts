import { z } from 'zod';
/** Semantic intentions only: no assets, licenses, playback, mixer, or capability registry. */
export const soundEffectIntentSchema = z.enum([
  'IMPACT',
  'WHOOSH',
  'POP',
  'COMEDY',
  'SURPRISE',
  'RISER',
  'DRAMATIC_HIT',
  'FAIL',
  'AMBIENCE',
  'CELEBRATION',
]);
const text = z.string().trim().min(1);
export const soundEffectKnowledgeSchema = z
  .object({
    id: soundEffectIntentSchema,
    knowledgeVersion: z.literal(1),
    profileVersion: z.number().int().positive(),
    purpose: text,
    useWhen: text,
    avoidWhen: text,
    relativeIntensity: z.enum(['SUBTLE', 'MODERATE', 'BUILDING']),
    visualRelationship: text,
    synchronization: text,
  })
  .strict();
export const soundEffectKnowledge = Object.freeze([
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'IMPACT',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Enfatizar um acontecimento de impacto.',
      useWhen: 'Quando houver ação ou mudança relevante visível.',
      avoidWhen: 'Evitar em ações triviais ou se mascarar fala.',
      relativeIntensity: 'MODERATE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization: 'Alinhar ao ápice perceptível do acontecimento.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'WHOOSH',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Acompanhar movimentos e transições.',
      useWhen: 'Quando houver movimento visível ou transição motivada.',
      avoidWhen: 'Evitar em cenas estáticas ou a cada corte sem motivo.',
      relativeIntensity: 'SUBTLE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization:
        'Acompanhar o movimento, sem antecipar uma ação inexistente.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'POP',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Destacar o surgimento de textos ou elementos.',
      useWhen: 'Quando um texto ou elemento importante surgir.',
      avoidWhen: 'Evitar em cada palavra de legenda ou elementos secundários.',
      relativeIntensity: 'SUBTLE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization: 'Alinhar ao aparecimento visual do elemento.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'COMEDY',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Enfatizar situações engraçadas.',
      useWhen:
        'Quando reforçar uma situação humorística sustentada pelo material.',
      avoidWhen:
        'Evitar explicar a piada, ridicularizar fora de contexto ou encobrir reações.',
      relativeIntensity: 'SUBTLE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization: 'Respeitar preparação, pausa e desfecho da piada.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'SURPRISE',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Destacar revelações e acontecimentos inesperados.',
      useWhen: 'Quando houver revelação ou quebra de expectativa perceptível.',
      avoidWhen: 'Evitar antecipar o desfecho ou inventar surpresa.',
      relativeIntensity: 'MODERATE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization: 'Alinhar à revelação visual, preservando a preparação.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'RISER',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Construir expectativa.',
      useWhen: 'Quando o conteúdo possuir preparação para uma revelação.',
      avoidWhen:
        'Evitar se antecipar indevidamente a piada ou prometer um impacto inexistente.',
      relativeIntensity: 'BUILDING',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization:
        'Acompanhar a preparação e cessar ou resolver no desfecho.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'DRAMATIC_HIT',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Enfatizar momentos dramáticos.',
      useWhen:
        'Quando houver impacto dramático compatível com o acontecimento.',
      avoidWhen: 'Evitar dramatização enganosa e saturação sonora.',
      relativeIntensity: 'MODERATE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization:
        'Coincidir com a virada ou impacto narrativo sustentado pelas imagens.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'FAIL',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Enfatizar falhas contextualizadas.',
      useWhen: 'Quando uma falha real contribuir para o conteúdo.',
      avoidWhen: 'Evitar atribuir falha inexistente ou prejudicar diálogos.',
      relativeIntensity: 'SUBTLE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization:
        'Entrar após a falha ficar compreensível, respeitando sua reação.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'AMBIENCE',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Complementar a ambientação.',
      useWhen:
        'Quando a atmosfera puder contextualizar o ambiente sem falseá-lo.',
      avoidWhen: 'Evitar mascarar sons relevantes ou sugerir fatos ausentes.',
      relativeIntensity: 'SUBTLE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization:
        'Acompanhar a permanência no ambiente com entradas e saídas suaves.',
    }),
  ),
  Object.freeze(
    soundEffectKnowledgeSchema.parse({
      id: 'CELEBRATION',
      knowledgeVersion: 1,
      profileVersion: 1,
      purpose: 'Enfatizar conquistas ou acontecimentos positivos.',
      useWhen:
        'Quando uma conquista ou resultado positivo estiver demonstrado.',
      avoidWhen:
        'Evitar celebrar um resultado inexistente ou exceder as reações originais.',
      relativeIntensity: 'MODERATE',
      visualRelationship:
        'Vincular a um acontecimento, elemento visual ou ambiente sustentado pelo material; não fabricar eventos.',
      synchronization:
        'Alinhar à confirmação do resultado ou à reação positiva.',
    }),
  ),
]);
