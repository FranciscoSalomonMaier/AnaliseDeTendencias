export const emptyNarrationState = { assets: [], scenes: [], selections: [], voices: [], styles: [], settings: null, readyCount: 0, busyCount: 0, sampleBusy: false };
export function sceneNarration(state, scene) {
  const status = state.scenes.find(s => s.sceneId === scene.id);
  const assets = state.assets.filter(a => a.sceneId === scene.id);
  const selected = assets.find(a => a.id === status?.selectedAssetId && a.status === "READY");
  const lastAttempt = assets.filter(a => a.source === "AI_GENERATED").at(-1);
  return { ...status, assets, selected, pending: assets.some(a => ["PENDING", "GENERATING"].includes(a.status)), failed: lastAttempt?.status === "FAILED" ? lastAttempt : null };
}
export function missingNarrationCount(state, scenes) {
  return scenes.filter(scene => { const a = sceneNarration(state, scene); return !a.ready && !a.pending; }).length;
}
export const audioDurationLabel = duration => Number.isFinite(duration) ? `${duration.toFixed(1).replace(".", ",")} s` : "—";
