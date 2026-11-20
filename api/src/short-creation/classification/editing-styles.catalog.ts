import { defineClassificationCatalog } from './catalog-entry';
export const editingStyles = defineClassificationCatalog([
  {
    id: 'DYNAMIC',
    name: 'Dinâmico',
    description:
      'Edição envolvente, com ritmo acelerado e estímulos visuais e sonoros.',
    available: false,
  },
  {
    id: 'MINIMALIST',
    name: 'Minimalista',
    description: 'Edição simples, com poucas intervenções visuais e sonoras.',
    available: false,
  },
  {
    id: 'DOCUMENTARY',
    name: 'Documental',
    description: 'Edição informativa, com foco no conteúdo apresentado.',
    available: false,
  },
  {
    id: 'CINEMATIC',
    name: 'Cinematográfico',
    description: 'Edição voltada à ambientação e à experiência audiovisual.',
    available: false,
  },
  {
    id: 'ANALOG_HORROR',
    name: 'Terror analógico',
    description:
      'Edição inspirada em gravações antigas, VHS e atmosferas perturbadoras.',
    available: false,
  },
  {
    id: 'RELAXING',
    name: 'Relaxante',
    description: 'Edição com ritmo tranquilo e atmosfera agradável.',
    available: false,
  },
  {
    id: 'NOSTALGIC',
    name: 'Nostálgico',
    description:
      'Edição que busca remeter a experiências, períodos ou memórias anteriores.',
    available: false,
  },
  {
    id: 'EPIC',
    name: 'Épico',
    description:
      'Edição voltada à intensidade, dramaticidade e impacto audiovisual.',
    available: false,
  },
]);
