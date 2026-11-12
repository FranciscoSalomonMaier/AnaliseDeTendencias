const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function request(id, path, method = "GET", body) {
  let response;
  try {
    response = await fetch(
      `${API_URL}/content-projects/${encodeURIComponent(id)}/intelligent-editing${path}`,
      {
        credentials: "include",
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      },
    );
  } catch {
    throw new Error("Não foi possível conectar à edição inteligente.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : "Não foi possível concluir a operação.",
    );
  return data;
}
export const intelligentEditing = {
  list: (id) => request(id, "/plans"),
  get: (id, plan) => request(id, `/plans/${plan}`),
  analyze: (project, options) =>
    request(project.id, "/analyze", "POST", {
      revision: project.revision,
      ...options,
      confirm: true,
    }),
  review: (id, plan, body) =>
    request(id, `/plans/${plan.id}`, "PATCH", {
      revision: plan.revision,
      ...body,
    }),
  approve: (id, plan) =>
    request(id, `/plans/${plan.id}/approve`, "POST", {
      revision: plan.revision,
    }),
  action: (id, plan, action) =>
    request(id, `/plans/${plan.id}/${action}`, "POST", {
      revision: plan.revision,
      confirm: true,
    }),
};
