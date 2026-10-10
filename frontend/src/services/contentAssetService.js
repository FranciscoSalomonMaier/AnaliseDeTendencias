const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const assetImageUrl = (asset) => asset?.url ? `${API_URL}${asset.url}` : "";
async function request(projectId, path, method = "GET", body) {
  let response;
  try {
    response = await fetch(`${API_URL}/content-projects/${encodeURIComponent(projectId)}${path}`, {
      method,
      headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {},
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("Não foi possível conectar à API. Verifique se o backend está em execução."); }
  if (!response.ok) {
    let message = "Não foi possível concluir a operação com a imagem.";
    try { const error = await response.json(); if (typeof error.message === "string") message = error.message; } catch { /* Non-JSON response. */ }
    const error = new Error(message); error.status = response.status; throw error;
  }
  return response.json();
}
function upload(project, sceneId, file, usage = "OPTIONAL") {
  const body = new FormData(); body.append("file", file); body.append("revision", String(project.revision)); body.append("usage", usage);
  return request(project.id, sceneId ? `/scenes/${sceneId}/images/upload` : "/references/upload", "POST", body);
}
export const contentAssets = {
  list: (projectId) => request(projectId, "/assets"),
  generate: (project, sceneId) => request(project.id, `/scenes/${sceneId}/images/generate`, "POST", { revision: project.revision }),
  missing: (project) => request(project.id, "/images/generate-missing", "POST", { revision: project.revision, confirm: true }),
  select: (project, sceneId, assetId) => request(project.id, `/scenes/${sceneId}/assets/${assetId}/select`, "PATCH", { revision: project.revision }),
  upload,
};
