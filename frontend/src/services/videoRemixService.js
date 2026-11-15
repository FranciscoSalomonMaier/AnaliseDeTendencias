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

export const remixImport = {
  settings: (id) => request(`/projects/${id}/import-settings`),
  search: (id, filters) =>
    request(`/projects/${id}/discovery/search`, "POST", filters),
  details: (id, video) =>
    request(`/projects/${id}/discovery/videos/${encodeURIComponent(video)}`),
  candidate: (project, externalId, replacement = {}) =>
    request(`/projects/${project.id}/candidates`, "POST", {
      revision: project.revision,
      externalId,
      ...replacement,
    }),
  attach: (project, sourceId, fileId, rights) =>
    request(`/projects/${project.id}/sources/${sourceId}/file`, "POST", {
      revision: project.revision,
      fileId,
      rights,
    }),
  unlink: (project, sourceId) =>
    request(`/projects/${project.id}/sources/${sourceId}/file`, "DELETE", {
      revision: project.revision,
      confirm: true,
    }),
  remove: (project, fileId) =>
    request(`/projects/${project.id}/files/${fileId}`, "DELETE", {
      revision: project.revision,
      confirm: true,
    }),
  withdraw: (project, sourceId) =>
    request(
      `/projects/${project.id}/sources/${sourceId}/authorization`,
      "PATCH",
      { revision: project.revision, rights: null },
    ),
  upload: (project, file, sourceId, rights, onProgress) => {
    const form = new FormData();
    form.append("revision", String(project.revision));
    if (sourceId) form.append("sourceId", sourceId);
    form.append("rights", JSON.stringify(rights));
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open("POST", `${API}/video-remix/projects/${project.id}/files`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* controlled fallback */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {
          const error = new Error(
            typeof data.message === "string"
              ? data.message
              : xhr.status === 413
                ? "Arquivo acima do limite permitido."
                : "Não foi possível importar o arquivo.",
          );
          error.status = xhr.status;
          reject(error);
        }
      };
      xhr.onerror = () =>
        reject(
          new Error("Falha de conexão durante o upload. Tente novamente."),
        );
      xhr.onabort = () => reject(new Error("Upload cancelado."));
      xhr.send(form);
    });
    return { promise, abort: () => xhr.abort() };
  },
};
export const remixFileUrl = (path) => `${API}${path}`;

export const remixAnalysis = {
  list: (project) => request(`/projects/${project}/analysis`),
  estimate: (project, data) =>
    request(`/projects/${project}/analysis/estimate`, "POST", data),
  start: (project, data) =>
    request(`/projects/${project}/analysis`, "POST", {
      ...data,
      confirm: true,
    }),
  results: (project, id) => request(`/projects/${project}/analysis/${id}`),
  cancel: (project, id) =>
    request(`/projects/${project}/analysis/${id}/cancel`, "POST", {}),
  retry: (project, id) =>
    request(`/projects/${project}/analysis/${id}/retry`, "POST", {}),
  select: (project, id, candidate, data) =>
    request(
      `/projects/${project}/analysis/${id}/candidates/${candidate}`,
      "PATCH",
      data,
    ),
  frameUrl: (project, id, frame) =>
    `${API}/video-remix/projects/${project}/analysis/${id}/frames/${frame}`,
};
