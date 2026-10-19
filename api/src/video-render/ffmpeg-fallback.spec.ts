jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { FfmpegRenderer } from './ffmpeg.renderer';
import { RenderFailure, MediaProcess } from './media-process';
import { RenderSettings } from './render-settings';
import { StorageProvider } from '../content-assets/storage.provider';
import { RenderJob } from './render-job';
import { ConfigService } from '@nestjs/config';
describe('Controlled movement fallback', () => {
  test.each([
    ['[Parsed_zoompan_0] Error when evaluating the expression', true],
    ['No space left on device', false],
    ['Permission denied', false],
    ['Invalid data found when processing input', false],
    ['[Parsed_xfade_0] Failed to configure output pad', false],
  ])(
    'only retries a recognized zoompan expression failure: %s',
    async (detail, retry) => {
      const root = await mkdtemp('/tmp/trends-fallback-');
      try {
        const image = join(root, 'image.png'),
          voice = join(root, 'voice.wav');
        await sharp({
          create: {
            width: 320,
            height: 180,
            channels: 3,
            background: '#804030',
          },
        })
          .png()
          .toFile(image);
        await writeFile(voice, 'placeholder; probe is mocked');
        const settings = new RenderSettings({
          get: (key: string) =>
            ({ VIDEO_RENDER_TEMP_DIR: root, VIDEO_RENDER_MIN_FREE_MB: 1 })[key],
        } as unknown as ConfigService);
        const run = jest
          .fn()
          .mockRejectedValueOnce(new RenderFailure('Falha', detail))
          .mockRejectedValue(new Error('stop after retry'));
        const renderer = new FfmpegRenderer(
          settings,
          { run } as unknown as MediaProcess,
          {
            copyTo: async (key: string, target: string) => {
              await copyFile(key, target);
            },
          } as unknown as StorageProvider,
        );
        jest.spyOn(renderer, 'probe').mockResolvedValue({
          streams: [
            { codec_type: 'audio', codec_name: 'pcm_s16le', duration: '1' },
          ],
        });
        const job = {
          id: '00000000-0000-4000-8000-000000000000',
          snapshot: {
            title: 'fallback',
            projectRevision: 1,
            config: { ...settings.config, width: 320, height: 180 },
            totalDurationSeconds: 1.3,
            scenes: [
              {
                sceneId: 's',
                order: 1,
                imageKey: image,
                audioKey: voice,
                audioMime: 'audio/wav',
                audioDurationSeconds: 1,
                frames: 39,
                startSeconds: 0,
                durationSeconds: 1.3,
                endSeconds: 1.3,
                motion: 'PAN_UP',
                requestedMotion: 'PAN_UP',
              },
            ],
          },
        } as RenderJob;
        await expect(
          renderer.render(
            job,
            new AbortController().signal,
            () => {},
            async () => {},
          ),
        ).rejects.toThrow(retry ? 'stop after retry' : detail);
        expect(run).toHaveBeenCalledTimes(retry ? 2 : 1);
        expect(job.snapshot.scenes[0].motion).toBe(retry ? 'STATIC' : 'PAN_UP');
        if (retry) expect(job.snapshot.scenes[0].fallbackReason).toBeTruthy();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
