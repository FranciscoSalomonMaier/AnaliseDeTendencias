import type { AudioResourceId } from './audio.schema';
export const audioRequiredFilters = [
  'aresample',
  'aformat',
  'asetpts',
  'atrim',
  'apad',
  'adelay',
  'amix',
  'anullsrc',
];
export const audioResourceFilters: Record<AudioResourceId, string[]> = {
  ORIGINAL_AUDIO: ['atempo', 'aloop', 'afade', 'volume'],
  BACKGROUND_MUSIC: ['atempo', 'aloop', 'afade', 'volume'],
  SOUND_EFFECT: ['atempo', 'aloop', 'afade', 'volume'],
  NARRATION: ['atempo', 'aloop', 'afade', 'volume'],
  AUDIO_VOLUME: ['volume'],
  AUDIO_FADE_IN: ['afade', 'volume'],
  AUDIO_FADE_OUT: ['afade', 'volume'],
  AUDIO_DUCKING: ['volume'],
  AUDIO_LOOP: ['aloop'],
  AUDIO_MIX: ['amix', 'alimiter', 'volume'],
};
