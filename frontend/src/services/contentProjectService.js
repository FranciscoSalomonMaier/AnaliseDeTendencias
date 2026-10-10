const API_URL = import.meta.env.VITE_API_URL;
async function request(path = "", method = "GET", body) {
  const response = await fetch(`${API_URL}/content-projects${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let message = "Não foi possível concluir a operação.";
    try {
      const error = await response.json();
      if (typeof error.message === "string") message = error.message;
    } catch {
      /* Non-JSON server error. */
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
export const contentProjects = {
  list: (offset = 0) => request(`?limit=50&offset=${offset}`),
  get: (id) => request(`/${encodeURIComponent(id)}`),
  create: (config) => request("", "POST", config),
  update: (project, config, confirm) =>
    request(`/${project.id}`, "PATCH", {
      revision: project.revision,
      config,
      confirm,
    }),
  generate: (project, stage, confirm) =>
    request(`/${project.id}/${stage}/generate`, "POST", {
      revision: project.revision,
      confirm,
    }),
  select: (project, ideaId, confirm) =>
    request(`/${project.id}/ideas/${ideaId}/select`, "POST", {
      revision: project.revision,
      confirm,
    }),
  saveScript: (project, script, confirm) =>
    request(`/${project.id}/script`, "PATCH", {
      revision: project.revision,
      script,
      confirm,
    }),
  approveScript: (project) =>
    request(`/${project.id}/script/approve`, "POST", {
      revision: project.revision,
    }),
  saveScene: (project, scene) =>
    request(`/${project.id}/scenes/${scene.id}`, "PATCH", {
      revision: project.revision,
      scene,
    }),
  approveScenes: (project) =>
    request(`/${project.id}/scenes/approve`, "POST", {
      revision: project.revision,
    }),
};
