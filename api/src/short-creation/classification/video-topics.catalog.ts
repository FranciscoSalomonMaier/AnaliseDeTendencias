import { defineClassificationCatalog } from './catalog-entry';
export const videoTopics = defineClassificationCatalog([
  {
    id: 'HUMOR',
    name: 'Humor',
    description:
      'Conteúdos engraçados, situações inesperadas, memes e entretenimento humorístico.',
    available: false,
  },
  {
    id: 'GAMING',
    name: 'Jogos',
    description: 'Conteúdos relacionados a jogos eletrônicos.',
    available: false,
  },
  {
    id: 'ANIMALS',
    name: 'Animais',
    description: 'Conteúdos relacionados a animais e natureza.',
    available: false,
  },
  {
    id: 'HORROR',
    name: 'Terror',
    description: 'Conteúdos de suspense, mistério, terror e creepypastas.',
    available: false,
  },
  {
    id: 'GENERAL_CURIOSITIES',
    name: 'Curiosidades gerais',
    description: 'Fatos interessantes e conhecimentos de assuntos variados.',
    available: false,
  },
]);
