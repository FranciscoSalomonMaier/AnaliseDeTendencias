const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function request(path, method = "GET", body) {
  let r;
  try {
    r = await fetch(`${API}/video-remix${path}`, {
      credentials: "include",
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Não foi possível conectar à API do Video Remix.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(
      typeof data.message === "string"
        ? data.message
        : "Não foi possível concluir a operação.",
    );
    error.status = r.status;
    throw error;
  }
  return data;
}
export const videoRemix = {
  list: (offset = 0) => request(`/projects?limit=20&offset=${offset}`),
  get: (id) => request(`/projects/${encodeURIComponent(id)}`),
  create: (data) => request("/projects", "POST", data),
  update: (project, data) =>
    request(`/projects/${project.id}`, "PATCH", {
      revision: project.revision,
      data,
    }),
  remove: (project) =>
    request(`/projects/${project.id}`, "DELETE", {
      revision: project.revision,
      confirm: true,
    }),
  sources: (id) => request(`/projects/${id}/sources`),
  addSource: (project, source) =>
    request(`/projects/${project.id}/sources`, "POST", {
      revision: project.revision,
      ...source,
    }),
  removeSource: (project, id) =>
    request(`/projects/${project.id}/sources/${id}`, "DELETE", {
      revision: project.revision,
      confirm: true,
    }),
  localAssets: () => request("/local-assets"),
};
