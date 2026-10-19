import type {
  GeneratedScript,
  GeneratedScene,
} from './content-generation.schema';
import { spokenText } from './spoken-text';

export function orderedScriptNarration(script: GeneratedScript): string {
  return [
    script.hook,
    script.introduction,
    ...script.sections.map((s) => s.narration),
    script.conclusion,
  ]
    .map(spokenText)
    .filter(Boolean)
    .join('\n\n');
}
function spokenWords(text: string) {
  return (
    text
      .normalize('NFC')
      .toLocaleLowerCase('pt-BR')
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
  );
}
export function scenesPreserveNarration(
  script: GeneratedScript,
  scenes: GeneratedScene[],
) {
  const expected = spokenWords(orderedScriptNarration(script));
  const actual = spokenWords(
    scenes.map((s) => spokenText(s.narration)).join(' '),
  );
  return (
    expected.length > 0 &&
    expected.length === actual.length &&
    expected.every((word, i) => word === actual[i])
  );
}
