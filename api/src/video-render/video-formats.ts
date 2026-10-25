export type VideoAspectRatio = '16:9' | '9:16';
export const VIDEO_FORMATS = {
  '16:9': { width: 1920, height: 1080, fps: 30, aspectRatio: '16:9' },
  '9:16': { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' },
} as const;
export function videoAspectRatio(
  width: number,
  height: number,
): VideoAspectRatio {
  return height > width ? '9:16' : '16:9';
}
