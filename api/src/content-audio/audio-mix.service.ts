import { Injectable } from '@nestjs/common';
import type { AudioMixSnapshot } from './audio-timeline.builder';
export interface MixInput {
  assetId: string;
  path: string;
}
@Injectable()
export class AudioMixService {
  // Input 0 is the concatenated H.264/PCM narration; other inputs use immutable local files.
  build(mix: AudioMixSnapshot | undefined, total: number, inputs: MixInput[]) {
    if (!mix || (!mix.music && !mix.effects.length))
      return {
        inputArgs: [] as string[],
        filters: null as string | null,
        map: '0:a:0',
      };
    const args: string[] = [],
      index = new Map<string, number>();
    for (const input of inputs) {
      index.set(input.assetId, index.size + 1);

      args.push('-protocol_whitelist', 'file,pipe', '-i', input.path);
    }
    const base =
      'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
    const filters = [
        `[0:a:0]${base},apad,atrim=duration=${total},asetpts=PTS-STARTPTS[narr]`,
      ],
      labels = ['[voice]'];
    if (mix.music && mix.settings.duckingEnabled)
      filters.push('[narr]asplit=2[voice][side]');
    else filters.push('[narr]anull[voice]');
    if (mix.music) {
      const s = mix.settings,
        duration = s.loopMusic
          ? total
          : Math.min(total, mix.music.durationSeconds);
      const loop = s.loopMusic
        ? `,aformat=sample_fmts=s16,aloop=loop=-1:size=${Math.ceil(mix.music.durationSeconds * 48000)}`
        : '';
      const fadeIn =
        s.musicFadeInSeconds > 0
          ? `,afade=t=in:st=0:d=${s.musicFadeInSeconds}`
          : '';
      const fadeOut =
        s.musicFadeOutSeconds > 0
          ? `,afade=t=out:st=${Math.max(0, duration - s.musicFadeOutSeconds)}:d=${s.musicFadeOutSeconds}`
          : '';
      filters.push(
        `[${index.get(mix.music.assetId)}:a:0]${base}${loop},asetpts=N/SR/TB,atrim=duration=${duration},volume=${s.musicVolume}${fadeIn}${fadeOut},apad,atrim=duration=${total}[music]`,
      );
      if (s.duckingEnabled)
        filters.push(
          '[music][side]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[bed]',
        );
      else filters.push('[music]anull[bed]');
      labels.push('[bed]');
    }
    mix.effects.forEach((effect, i) => {
      const edge = Math.min(0.01, effect.durationSeconds / 2),
        n = index.get(effect.assetId);
      filters.push(
        `[${n}:a:0]${base},atrim=duration=${effect.durationSeconds},asetpts=PTS-STARTPTS,volume=${effect.volume},afade=t=in:st=0:d=${edge},afade=t=out:st=${effect.durationSeconds - edge}:d=${edge},adelay=${Math.round(effect.startSeconds * 48000)}S:all=1[fx${i}]`,
      );
      labels.push(`[fx${i}]`);
    });
    filters.push(
      `${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.85:level=0:attack=5:release=50:latency=1,atrim=duration=${total},asetpts=PTS-STARTPTS[mixed]`,
    );
    return { inputArgs: args, filters: filters.join(';'), map: '[mixed]' };
  }
}
