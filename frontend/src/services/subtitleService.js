const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const subtitleUrl = (id, path = "") => `${API_URL}/content-projects/${encodeURIComponent(id)}/subtitles${path}`;
async function request(id, path, method = "GET", body) {
  let response;
  try { response = await fetch(`${API_URL}/content-projects/${encodeURIComponent(id)}${path}`, { credentials: "include", method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("Não foi possível conectar à API de legendas."); }
  if (!response.ok) { let message = "Não foi possível processar as legendas."; try { const data = await response.json(); if (typeof data.message === "string") message = data.message; } catch { /* Non-JSON error. */ } throw new Error(message); }
  return response.json();
}
export const subtitles = {
  list: id => request(id, "/subtitles"),
  generate: (project, sceneId, replace = false) => request(project.id, `/scenes/${sceneId}/subtitles/generate`, "POST", { revision: project.revision, replace }),
  missing: project => request(project.id, "/subtitles/generate-missing", "POST", { revision: project.revision }),
  settings: (project, settings) => request(project.id, "/subtitle-settings", "PATCH", { revision: project.revision, settings }),
  edit: (project, sceneId, versionId, segments) => request(project.id, `/scenes/${sceneId}/subtitles/${versionId}`, "PATCH", { revision: project.revision, segments }),
  select: (project, sceneId, versionId) => request(project.id, `/scenes/${sceneId}/subtitles/${versionId}/select`, "POST", { revision: project.revision, confirmReview: true }),
  download: async id => {
    let response; try { response = await fetch(subtitleUrl(id, "/export/srt"), {credentials:"include"}); } catch { throw new Error("Não foi possível conectar à API."); }
    if (!response.ok) { const data = await response.json(); throw new Error(data.message ?? "Não foi possível exportar SRT."); }
    const url = URL.createObjectURL(await response.blob()), link = document.createElement("a"); link.href = url; link.download = "subtitles.srt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
