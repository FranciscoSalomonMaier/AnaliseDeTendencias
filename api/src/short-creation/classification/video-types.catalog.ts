import { defineClassificationCatalog } from './catalog-entry';
export const videoTypes = defineClassificationCatalog([
  {
    id: 'TOP_X',
    name: 'Top X',
    description: 'Apresentação de conteúdos organizados em um ranking.',
    available: false,
  },
  {
    id: 'X_THINGS_ABOUT',
    name: 'X coisas sobre',
    description:
      'Apresentação de múltiplos fatos ou informações sobre determinado assunto.',
    available: false,
  },
  {
    id: 'CURIOSITY',
    name: 'Curiosidades',
    description:
      'Apresentação de um fato, acontecimento ou informação interessante.',
    available: false,
  },
  {
    id: 'GAMEPLAY',
    name: 'Gameplay',
    description:
      'Apresentação de acontecimentos, momentos ou trechos de jogos.',
    available: false,
  },
  {
    id: 'VIBE',
    name: 'Vibe / Aesthetic',
    description:
      'Conteúdo voltado à experiência visual, sonora ou atmosférica.',
    available: false,
  },
]);
