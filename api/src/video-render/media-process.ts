import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
export class RenderFailure extends Error {
  constructor(
    public readonly publicMessage: string,
    detail?: string,
  ) {
    super(detail ?? publicMessage);
  }
}
export class RenderCancelled extends Error {}
@Injectable()
export class MediaProcess {
  private readonly logger = new Logger(MediaProcess.name);
  run(
    binary: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
    onProgress?: (seconds: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new RenderCancelled());
        return;
      }
      const child = spawn(binary, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '',
        stderr = '',
        progressBuffer = '',
        reason: Error | undefined,
        killTimer: NodeJS.Timeout | undefined;
      const stop = (error: Error) => {
        if (reason) return;
        reason = error;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 1500);
        killTimer.unref();
      };
      const abort = () => stop(new RenderCancelled());
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () =>
          stop(
            new RenderFailure(
              'Renderização excedeu o tempo limite. Tente novamente ou reduza o projeto.',
            ),
          ),
        timeoutMs,
      );
      child.stdout.on('data', (chunk: Buffer) => {
        const value = chunk.toString();
        if (onProgress) {
          progressBuffer += value;
          let index: number;
          while ((index = progressBuffer.indexOf('\n')) >= 0) {
            const line = progressBuffer.slice(0, index);
            progressBuffer = progressBuffer.slice(index + 1);
            if (line.startsWith('out_time_us=')) {
              const seconds = Number(line.slice(12)) / 1e6;
              if (Number.isFinite(seconds)) onProgress(seconds);
            }
          }
          if (progressBuffer.length > 8192) progressBuffer = '';
        } else {
          stdout += value;
          if (stdout.length > 1024 * 1024)
            stop(
              new RenderFailure(
                'Resposta de análise de mídia acima do limite.',
              ),
            );
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-32768);
      });
      const cleanup = () => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
      };
      child.on('error', (error: NodeJS.ErrnoException) => {
        cleanup();
        reject(
          new RenderFailure(
            error.code === 'ENOENT'
              ? 'FFmpeg ou FFprobe indisponível. Verifique os executáveis configurados.'
              : 'Não foi possível iniciar o processo de mídia.',
            error.message,
          ),
        );
      });
      child.on('close', (code) => {
        cleanup();
        if (reason) {
          reject(reason);
          return;
        }
        if (code !== 0) {
          this.logger.error(
            `Processo de mídia encerrado com código ${code}: ${stderr}`,
          );
          reject(
            new RenderFailure(
              /No space left/i.test(stderr)
                ? 'Espaço em disco insuficiente para renderizar o vídeo.'
                : 'Falha de processamento ou codec de mídia. Verifique os arquivos selecionados.',
              stderr,
            ),
          );
          return;
        }
        resolve(stdout);
      });
    });
  }
}
