import type {
  GeneratedScript,
  GeneratedScene,
} from './content-generation.schema';
import {
  orderedScriptNarration,
  scenesPreserveNarration,
} from './narrative-continuity';
import { projectPrompt } from './prompts/content-project.prompt';
import { scriptGenerationPrompt } from './prompts/script-generation.prompt';
import { sceneGenerationPrompt } from './prompts/scene-generation.prompt';
import type { ProjectConfig } from '../../content-projects/content-project.schema';
const script: GeneratedScript = {
  title: 'Uma única história',
  conclusion: 'Elias voltou para casa.',
  sections: [
    { title: 'Seção um', narration: 'Ele ouviu uma voz.' },
    { title: 'Seção dois', narration: 'Por isso abriu a porta.' },
  ],
  introduction: 'Elias estava no corredor.',
  hook: 'Alguém chamou por Elias.',
  estimatedDurationSeconds: 60,
  researchRequired: false,
  researchNotes: ['Nota que não deve ser falada.'],
};
const scene = (narration: string, order = 1): GeneratedScene => ({
  order,
  narration,
  visualDescription: 'Corredor escuro.',
  imagePrompt: 'Corredor com uma porta.',
  estimatedDurationSeconds: 10,
});
describe('ordered narration and continuity at scene boundaries', () => {
  test('canonical spoken order ignores JSON key order and excludes headings and research notes', () => {
    expect(orderedScriptNarration(script)).toBe(
      'Alguém chamou por Elias.\n\nElias estava no corredor.\n\nEle ouviu uma voz.\n\nPor isso abriu a porta.\n\nElias voltou para casa.',
    );
  });
  test('different scene cuts preserve the exact word sequence', () => {
    expect(
      scenesPreserveNarration(script, [
        scene(script.hook + ' ' + script.introduction),
        scene(script.sections[0].narration, 2),
        scene(script.sections[1].narration + ' ' + script.conclusion, 3),
      ]),
    ).toBe(true);
  });
  test('punctuation, case and line breaks are not mistaken for missing narrative', () => {
    expect(
      scenesPreserveNarration(script, [
        scene(
          orderedScriptNarration(script)
            .toUpperCase()
            .replace(/\./g, '!')
            .replace(/\n/g, ' '),
        ),
      ]),
    ).toBe(true);
  });
  test('putting the hook after the introduction is rejected', () => {
    expect(
      scenesPreserveNarration(script, [
        scene(
          [
            script.introduction,
            script.hook,
            ...script.sections.map((s) => s.narration),
            script.conclusion,
          ].join(' '),
        ),
      ]),
    ).toBe(false);
  });
  test.each(['omit', 'repeat', 'invent', 'reorder'])(
    'rejects %s instead of silently rewriting approved narration',
    (change) => {
      const parts = [
        script.hook,
        script.introduction,
        ...script.sections.map((s) => s.narration),
        script.conclusion,
      ];
      if (change === 'omit') parts.splice(2, 1);
      if (change === 'repeat') parts.splice(2, 0, parts[1]);
      if (change === 'invent') parts.push('Outra pessoa surgiu do nada.');
      if (change === 'reorder') [parts[2], parts[3]] = [parts[3], parts[2]];
      expect(scenesPreserveNarration(script, [scene(parts.join(' '))])).toBe(
        false,
      );
    },
  );
  test('explicit visual directions can be excluded without deleting story descriptions', () => {
    const original = {
      ...script,
      introduction: '[Imagem: corredor.] ' + script.introduction,
    };
    expect(
      scenesPreserveNarration(original, [
        scene(orderedScriptNarration(script)),
      ]),
    ).toBe(true);
    expect(
      scenesPreserveNarration(script, [
        scene(orderedScriptNarration(script).replace('corredor', 'saguão')),
      ]),
    ).toBe(false);
  });
  test('both prompt paths request causal continuity and canonical source order', () => {
    const config = {
      topic: 'Mistério',
      type: 'VIDEO',
      style: 'DARK',
      language: 'pt-BR',
      targetDurationSeconds: 60,
      instructions: '',
    } as ProjectConfig;
    expect(projectPrompt('script', config).userPrompt).toContain(
      'missing causal links',
    );
    expect(scriptGenerationPrompt('pt-BR')).toContain('missing causal links');
    expect(
      projectPrompt('scenes', config, undefined, script).userPrompt,
    ).toContain(JSON.stringify(orderedScriptNarration(script)));
    expect(sceneGenerationPrompt('pt-BR')).toContain(
      'Do not move the hook after the introduction',
    );
  });
});
