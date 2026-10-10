const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const audioAssetUrl = asset => asset?.url ? `${API_URL}${asset.url}` : "";
async function request(projectId, path, method = "GET", body) {
  let response;
  try {
    response = await fetch(`${API_URL}/content-projects/${encodeURIComponent(projectId)}${path}`, {
      method, headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {},
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("Não foi possível conectar à API de narração. Verifique o backend."); }
  if (!response.ok) {
    let message = "Não foi possível concluir a operação com a narração.";
    try { const result = await response.json(); if (typeof result.message === "string") message = result.message; } catch { /* Non-JSON errors. */ }
    const error = new Error(message); error.status = response.status; throw error;
  }
  return response.json();
}
export const contentNarration = {
  list: id => request(id, "/audio/progress"),
  settings: (project, settings) => request(project.id, "/narration-settings", "PATCH", { revision: project.revision, ...settings }),
  generate: (project, sceneId) => request(project.id, `/scenes/${sceneId}/audio/generate`, "POST", { revision: project.revision }),
  missing: project => request(project.id, "/audio/generate-missing", "POST", { revision: project.revision, confirm: true }),
  sample: project => request(project.id, "/audio/sample", "POST", { revision: project.revision, confirm: true }),
  select: (project, sceneId, assetId) => request(project.id, `/scenes/${sceneId}/audio/${assetId}/select`, "PATCH", { revision: project.revision }),
  upload: (project, sceneId, file) => {
    const body = new FormData(); body.append("file", file); body.append("revision", String(project.revision));
    return request(project.id, `/scenes/${sceneId}/audio/upload`, "POST", body);
  },
};
