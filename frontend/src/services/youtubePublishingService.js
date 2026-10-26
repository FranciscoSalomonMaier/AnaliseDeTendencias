const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function request(path, method = "GET", body) {
  let response;
  try {
    response = await fetch(`${API}/youtube-publishing${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Não foi possível conectar à integração com o YouTube.");
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      typeof data.message === "string"
        ? data.message
        : "Operação YouTube inválida.",
    );
    error.status = response.status;
    error.code = data.code;
    error.issues = data.issues;
    throw error;
  }
  return data;
}
const id = (value) => encodeURIComponent(value);
export const youtubePublishing = {
  operations: () => request("/operations"),
  configuration: () => request("/configuration"),
  authorize: () => request("/oauth/authorize", "POST", { confirm: true }),
  verify: (channel) =>
    request(`/channels/${id(channel)}/verify`, "POST", { confirm: true }),
  disconnect: (channel) =>
    request(`/channels/${id(channel)}`, "DELETE", { confirm: true }),
  validate: (body) => request("/publications/validate", "POST", body),
  create: (body) => request("/publications", "POST", body),
  list: (filters) =>
    request(
      "/publications?" +
        new URLSearchParams(
          Object.entries(filters ?? {}).filter(([, v]) => v),
        ).toString(),
    ),
  get: (publication) => request(`/publications/${id(publication)}`),
  upload: (publication) =>
    request(`/publications/${id(publication)}/upload`, "POST", {
      confirm: true,
    }),
  retry: (publication) =>
    request(`/publications/${id(publication)}/retry`, "POST", {
      confirm: true,
    }),
  cancel: (publication) =>
    request(`/publications/${id(publication)}/cancel`, "POST", {
      confirm: true,
    }),
  status: (publication, videoId) =>
    request(`/publications/${id(publication)}/status`, "POST", {
      confirm: true,
      ...(videoId ? { videoId } : {}),
    }),
  thumbnail: (publication) =>
    request(`/publications/${id(publication)}/thumbnail/retry`, "POST", {
      confirm: true,
    }),
  automation: (project) =>
    request(`/automation/${id(project)}`).then((result) => result.settings),
  saveAutomation: (project, settings) =>
    request(`/automation/${id(project)}`, "PATCH", {
      ...settings,
      confirm: true,
    }),
};
