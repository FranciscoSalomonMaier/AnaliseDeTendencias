import { hasVisualDirections, spokenText } from './spoken-text';
describe('spoken narration excludes explicit visual directions', () => {
  test.each([
    '[Imagem simulada: corredor vazio, luzes piscando.]',
    '[Corte para uma gravação tremida.]',
    '[Imagem: monitores com linhas horizontais.]',
    '[Corte: câmera 01, horário 3h17.]',
    '[Image: dark corridor.]',
    '[Shot: a wide frame.]',
  ])(
    'removes production direction %s but retains spoken narrative',
    (direction) => {
      expect(spokenText(`${direction} A câmera mostrava o corredor.`)).toBe(
        'A câmera mostrava o corredor.',
      );
      expect(hasVisualDirections(direction)).toBe(true);
    },
  );
  test('preserves story descriptions and bracketed dialogue', () => {
    const text =
      'A imagem cresceu na tela. O relógio marcava [3h17]. Ele leu [não olhe para trás].';
    expect(spokenText(text)).toBe(text);
    expect(hasVisualDirections(text)).toBe(false);
  });
  test('removes inline directions and preserves paragraphs', () => {
    expect(
      spokenText(
        'Ele entrou. [Imagem: sala escura.] Ela desapareceu.\n\n[Corte: corredor.] Ele voltou.',
      ),
    ).toBe('Ele entrou. Ela desapareceu.\n\nEle voltou.');
  });
  test('directions without narration produce empty text for normal validation to reject', () => {
    expect(spokenText('[Imagem: sala.]')).toBe('');
  });
});
