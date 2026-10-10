import { MediaProcess, RenderCancelled } from './media-process';

describe('Media subprocess boundaries', () => {
  const processRunner = new MediaProcess();
  it('passes hostile-looking arguments literally without a shell', async () => {
    const argument = '$(touch /tmp/not-executed); echo secret';
    expect(
      await processRunner.run(
        process.execPath,
        ['-e', 'process.stdout.write(process.argv[1])', argument],
        5000,
      ),
    ).toBe(argument);
  });
  it('parses actual microsecond progress, including split writes', async () => {
    const progress: number[] = [];
    await processRunner.run(
      process.execPath,
      [
        '-e',
        'process.stdout.write("out_time_us=1"); setTimeout(()=>process.stdout.write("500000\\nprogress=end\\n"),20)',
      ],
      5000,
      undefined,
      (seconds) => progress.push(seconds),
    );
    expect(progress).toEqual([1.5]);
  });
  it('terminates a child on timeout', async () => {
    await expect(
      processRunner.run(
        process.execPath,
        ['-e', 'setInterval(()=>{},1000)'],
        100,
      ),
    ).rejects.toThrow('tempo limite');
  });
  it('terminates a running child when cancelled', async () => {
    const abort = new AbortController();
    const result = processRunner.run(
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      5000,
      abort.signal,
    );
    setTimeout(() => abort.abort(), 100);
    await expect(result).rejects.toBeInstanceOf(RenderCancelled);
  });
  it('reports a missing executable clearly', async () => {
    await expect(
      processRunner.run('/missing-trends-ffmpeg', [], 5000),
    ).rejects.toMatchObject({
      publicMessage:
        'FFmpeg ou FFprobe indisponível. Verifique os executáveis configurados.',
    });
  });
  it('bounds diagnostic output', async () => {
    await expect(
      processRunner.run(
        process.execPath,
        [
          '-e',
          'process.stdout.write("x".repeat(2*1024*1024));setInterval(()=>{},1000)',
        ],
        2000,
      ),
    ).rejects.toMatchObject({
      publicMessage: 'Resposta de análise de mídia acima do limite.',
    });
  });
});
