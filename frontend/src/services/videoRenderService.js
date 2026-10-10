const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const renderMediaUrl = path => path ? `${API_URL}${path}` : "";
async function request(projectId, path, method = "GET", body) {
  let response;
  try { response = await fetch(`${API_URL}/content-projects/${encodeURIComponent(projectId)}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("Não foi possível conectar à API de renderização."); }
  if (!response.ok) {
    let result = {}; try { result = await response.json(); } catch { /* Non-JSON error. */ }
    const error = new Error(typeof result.message === "string" ? result.message : "Não foi possível concluir a renderização."); error.status = response.status; error.issues = result.issues ?? []; throw error;
  }
  return response.json();
}
export const videoRenders = {
  timeline: id => request(id, "/timeline"), list: id => request(id, "/renders"),
  create: project => request(project.id, "/renders", "POST", { revision: project.revision }),
  cancel: (projectId, jobId) => request(projectId, `/renders/${jobId}/cancel`, "POST"),
};
