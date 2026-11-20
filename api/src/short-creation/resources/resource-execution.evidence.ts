/** Version-bound evidence from test/shorts/resources/resource-execution.integration.cjs.
 * Contract/executor changes require rerunning the real synthetic execution suite. */
export const RESOURCE_EXECUTOR_VERSION = 1 as const;
export const resourceExecutionEvidence: Readonly<
  Record<
    string,
    { resourceVersion: number; executorVersion: number; fixtureVersion: number }
  >
> = Object.freeze(
  Object.fromEntries(
    [
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
      }),
    ]),
  ),
);
