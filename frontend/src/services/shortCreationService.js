const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const shortMediaUrl = (path) => API + path;
async function request(path, method = "GET", body) {
  let r;
  try {
    r = await fetch(`${API}/shorts${path}`, {
      method,
      credentials: "include",
      headers:
        body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {},
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  } catch {
    throw Error("Não foi possível conectar ao servidor.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = Error(
      typeof data.message === "string"
        ? data.message
        : "Não foi possível concluir a operação.",
    );
    error.status = r.status;
    throw error;
  }
  return data;
}
export const shorts = {
  options: () => request("/options"),
  list: () => request(""),
  create: (data) => request("", "POST", data),
  get: (id) => request(`/${id}`),
  save: (project, data) =>
    request(`/${project.id}`, "PATCH", { revision: project.revision, ...data }),
  run: (project, kind, semantic = false) =>
    request(`/${project.id}/jobs`, "POST", {
      revision: project.revision,
      kind,
      semantic,
      confirm: true,
    }),
  upload: (id, file) => {
    const data = new FormData();
    data.append("rights", "true");
    data.append("file", file);
    return request(`/${id}/files`, "POST", data);
  },
  uploadReference: (id, file) => {
    const data = new FormData();
    data.append("rights", "true");
    data.append("file", file);
    return request(`/${id}/references`, "POST", data);
  },
  removeReference: (id, file) => request(`/${id}/references/${file}`, "DELETE"),
  removeFile: (id, file) => request(`/${id}/files/${file}`, "DELETE"),
  remove: (id) => request(`/${id}`, "DELETE"),
};
