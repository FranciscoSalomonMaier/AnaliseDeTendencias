const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function request(id, path, method = "GET", body) {
  let response;
  try { response = await fetch(`${API_URL}/content-projects/${encodeURIComponent(id)}${path}`, { method, headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("Não foi possível conectar à API de mixagem. Verifique o backend."); }
  if (!response.ok) { let message = "Não foi possível salvar ou enviar o áudio."; try { const result = await response.json(); if (typeof result.message === "string") message = result.message; } catch { /* Non-JSON response. */ } throw new Error(message); }
  return response.json();
}
export const projectAudio = {
  get: id => request(id, "/audio-settings"),
  save: (project, settings) => request(project.id, "/audio-settings", "PATCH", { revision: project.revision, settings }),
  upload: (project, role, file, metadata) => {
    const body = new FormData(); body.append("file", file); body.append("revision", String(project.revision));
    for (const key of ["license", "origin", "notes"]) body.append(key, metadata[key] ?? "");
    return request(project.id, role === "BACKGROUND_MUSIC" ? "/music/upload" : "/sound-effects/upload", "POST", body);
  },
};
