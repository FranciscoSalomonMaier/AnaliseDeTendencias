import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ImageSettings } from './image-settings';

@Injectable()
export class ImageGenerationQueue {
  private active = 0;
  private jobs: Array<() => Promise<void>> = [];
  private readonly logger = new Logger(ImageGenerationQueue.name);
  constructor(private readonly settings: ImageSettings) {}
  ensureCapacity(count: number) {
    if (this.active + this.jobs.length + count > this.settings.maxQueued)
      throw new ServiceUnavailableException(
        'Fila de imagens cheia. Aguarde e tente novamente.',
      );
  }
  enqueue(job: () => Promise<void>) {
    this.jobs.push(job);
    this.drain();
  }
  private drain() {
    while (this.active < this.settings.concurrency && this.jobs.length) {
      const job = this.jobs.shift()!;
      this.active++;
      void job()
        .catch(() =>
          this.logger.error(
            'Falha ao persistir o resultado de uma geração de imagem.',
          ),
        )
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
