import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { YouTubeVideo } from '../../src/sources/youtube/interfaces/youtube-video.interface';

@Injectable()
export class SemanticTextBuilder {
  clean(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
      .replace(/@[\w.-]+/g, ' ')
      .replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  build(video: YouTubeVideo): { text: string; hash: string } {
    const title = this.clean(video.snippet.title).slice(0, 350);
    const tags = [
      ...new Set(
        (video.snippet.tags ?? [])
          .map((tag) => this.clean(tag).slice(0, 100))
          .filter(Boolean),
      ),
    ]
      .sort()
      .slice(0, 20);
    const description = (video.snippet.description ?? '')
      .split(/\n+/)
      .filter(
        (line) =>
          !/https?:|www\.|inscreva|subscribe|siga |follow |cupom|desconto|patrocin|sponsor|copyright|cr[eé]ditos|contato|booking|pix|compre|download|baixe/i.test(
            line,
          ),
      )
      .map((line) => this.clean(line))
      .filter(Boolean)
      .slice(0, 5)
      .join(' ')
      .slice(0, 700);
    // Numeric category IDs are technical metadata, not semantic content.
    const category = this.clean(video.categoryTitle ?? '').slice(0, 80);
    const text = [
      'Semantic video context v1',
      `Title: ${title}`,
      tags.length ? `Tags: ${tags.join(', ')}` : '',
      description ? `Description: ${description}` : '',
      category ? `Category context: ${category}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { text, hash: createHash('sha256').update(text).digest('hex') };
  }
}
