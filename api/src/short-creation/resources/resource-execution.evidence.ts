/** Version-bound evidence from resource-execution.integration.cjs graphics-execution.integration.cjs and audio-execution.integration.cjs.
 * Contract/executor changes require rerunning the real synthetic execution suite. */
export const RESOURCE_EXECUTOR_VERSION = 1 as const;
export const resourceExecutionEvidence: Readonly<
  Record<
    string,
    {
      resourceVersion: number;
      executorVersion: number;
      fixtureVersion: number;
      graphicsRendererVersion?: number;
      audioEngineVersion?: number;
    }
  >
> = Object.freeze(
  Object.fromEntries(
    [
      'ORIGINAL_AUDIO',
      'BACKGROUND_MUSIC',
      'SOUND_EFFECT',
      'NARRATION',
      'AUDIO_VOLUME',
      'AUDIO_FADE_IN',
      'AUDIO_FADE_OUT',
      'AUDIO_DUCKING',
      'AUDIO_LOOP',
      'AUDIO_MIX',
      'FIXED_TITLE',
      'TEMPORARY_TEXT',
      'STYLED_TEXT',
      'CAPTIONS',
      'WORD_HIGHLIGHT',
      'EMOJI',
      'IMAGE_OVERLAY',
      'LOGO',
      'WATERMARK',
      'RANKING_PANEL',
      'RANKING_REVEAL',
      'TEXT_ANIMATION',
      'CUT',
      'CONCAT',
      'SPEED_CHANGE',
      'FREEZE_FRAME',
      'REPEAT_SEGMENT',
      'RESIZE',
      'CROP',
      'POSITION',
      'FIT',
      'FILL',
      'SOLID_BACKGROUND',
      'BLUR_BACKGROUND',
      'STATIC_ZOOM',
      'DYNAMIC_ZOOM',
      'CAMERA_SHAKE',
      'MOTION_BLUR',
      'GAUSSIAN_BLUR',
      'VIGNETTE',
      'FILM_GRAIN',
      'GLITCH',
      'HARD_CUT',
      'FADE_IN',
      'FADE_OUT',
      'CROSSFADE',
      'ZOOM_TRANSITION',
      'SLIDE_TRANSITION',
      'BRIGHTNESS',
      'CONTRAST',
      'SATURATION',
      'GAMMA',
      'COLOR_TEMPERATURE',
      'GRAYSCALE',
      'SEPIA',
    ].map((id) => [
      id,
      Object.freeze({
        resourceVersion: 1,
        executorVersion: 1,
        fixtureVersion: 1,
        ...([
          'ORIGINAL_AUDIO',
          'BACKGROUND_MUSIC',
          'SOUND_EFFECT',
          'NARRATION',
          'AUDIO_VOLUME',
          'AUDIO_FADE_IN',
          'AUDIO_FADE_OUT',
          'AUDIO_DUCKING',
          'AUDIO_LOOP',
          'AUDIO_MIX',
        ].includes(id)
          ? { audioEngineVersion: 1 }
          : {}),
        ...([
          'FIXED_TITLE',
          'TEMPORARY_TEXT',
          'STYLED_TEXT',
          'CAPTIONS',
          'WORD_HIGHLIGHT',
          'EMOJI',
          'IMAGE_OVERLAY',
          'LOGO',
          'WATERMARK',
          'RANKING_PANEL',
          'RANKING_REVEAL',
          'TEXT_ANIMATION',
        ].includes(id)
          ? { graphicsRendererVersion: 1 }
          : {}),
      }),
    ]),
  ),
);
