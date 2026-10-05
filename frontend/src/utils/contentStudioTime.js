export function formatStudioDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}

export function calculateSceneTimestamps(scenes) {
  let elapsedSeconds = 0;
  return scenes.map((scene) => {
    const startSeconds = elapsedSeconds;
    elapsedSeconds += Math.max(0, Number(scene.estimatedDurationSeconds) || 0);
    return { startSeconds, endSeconds: elapsedSeconds };
  });
}

export function countScriptWords(script) {
  const narration = [
    script.hook,
    script.introduction,
    ...script.sections.map((section) => section.narration),
    script.conclusion,
  ].join(' ').trim();
  return narration ? narration.split(/\s+/).length : 0;
}
