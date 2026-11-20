import { z } from 'zod';
export const shortMusicSettingsSchema = z
  .object({
    volume: z.number().finite().min(0).max(1).default(0.15),
    fadeIn: z.boolean().default(true),
    fadeInSeconds: z.number().finite().min(0).max(30).default(1),
    fadeOut: z.boolean().default(true),
    fadeOutSeconds: z.number().finite().min(0).max(30).default(0.5),
    loop: z.boolean().default(true),
    ducking: z.boolean().default(true),
  })
  .strict();
export const defaultShortMusic = () => shortMusicSettingsSchema.parse({});
export type ShortMusicSettings = z.infer<typeof shortMusicSettingsSchema>;
export interface ShortMusic {
  id: string;
  key: string;
  originalName: string;
  bytes: number;
  duration: number;
  mime: string;
  codec: string;
  sampleRate: number;
  channels: number;
  rightsDeclaredAt: string;
}
export const musicFormats: Record<
  string,
  { mime: string; accepted: string[]; format: string; codecs: string[] }
> = {
  mp3: {
    mime: 'audio/mpeg',
    accepted: ['audio/mpeg', 'audio/mp3'],
    format: 'mp3',
    codecs: ['mp3'],
  },
  wav: {
    mime: 'audio/wav',
    accepted: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
    format: 'wav',
    codecs: ['pcm_'],
  },
  aac: {
    mime: 'audio/aac',
    accepted: ['audio/aac', 'audio/x-aac'],
    format: 'aac',
    codecs: ['aac'],
  },
  m4a: {
    mime: 'audio/mp4',
    accepted: ['audio/mp4', 'audio/m4a', 'audio/x-m4a'],
    format: 'mov',
    codecs: ['aac', 'alac'],
  },
  ogg: {
    mime: 'audio/ogg',
    accepted: ['audio/ogg', 'application/ogg', 'audio/opus'],
    format: 'ogg',
    codecs: ['vorbis', 'opus', 'flac'],
  },
  flac: {
    mime: 'audio/flac',
    accepted: ['audio/flac', 'audio/x-flac'],
    format: 'flac',
    codecs: ['flac'],
  },
};
