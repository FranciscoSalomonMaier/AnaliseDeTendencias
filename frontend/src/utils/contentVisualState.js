export const emptyVisualState = { assets: [], scenes: [], selections: [], readyCount: 0, totalCount: 0, busyCount: 0 };
export function sceneVisual(state, scene) {
  const visual = state.scenes.find(v => v.sceneId === scene.id);
  const selected = state.assets.find(a => a.id === visual?.selectedAssetId && a.status === "READY");
  const assets = state.assets.filter(a => a.sceneId === scene.id);
  const lastAttempt = assets.filter(a => a.source === "AI_GENERATED").at(-1);
  return { selected, assets, outdated: Boolean(visual?.outdated), pending: assets.some(a => ["PENDING", "GENERATING"].includes(a.status)), failed: lastAttempt?.status === "FAILED" ? lastAttempt : null };
}
export function missingVisualCount(state, scenes) {
  return scenes.filter(s => { const v = sceneVisual(state, s); return !v.selected && !v.pending; }).length;
}
export function requiredReferencesMissing(state) {
  const selected = new Set(state.scenes.filter(s => s.ready).map(s => s.selectedAssetId));
  return state.assets.filter(a => a.sceneId === null && a.status === "READY" && a.usage === "REQUIRED" && !selected.has(a.id));
}
