// UI helpers contain no classification catalogs or executable editing settings.
export const editingMode = (project) =>
  project.data.editingMode ?? "LEGACY_REFERENCE";
export function editorialDraft(project, preferenceOptions) {
  return {
    classification: {
      version: 1,
      videoType: "",
      videoTopic: "",
      editingStyle: "",
      ...project.data.classification,
    },
    preferences: {
      version: 1,
      additionalInstructions: "",
      cutRhythm: "AUTO",
      ...project.data.editorialPreferences,
      resources: {
        ...Object.fromEntries(
          (preferenceOptions?.resources ?? []).map(({ id }) => [id, "AUTO"]),
        ),
        ...project.data.editorialPreferences?.resources,
      },
    },
  };
}
export function editorialCatalogState(catalogs, classification) {
  const axes = [
    ["videoType", "videoTypes"],
    ["videoTopic", "videoTopics"],
    ["editingStyle", "editingStyles"],
  ];
  const ready =
    Number.isInteger(catalogs?.version) &&
    axes.every(
      ([, key]) =>
        Array.isArray(catalogs[key]) &&
        catalogs[key].length > 0 &&
        catalogs[key].every(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.description === "string" &&
            typeof item.available === "boolean",
        ) &&
        new Set(catalogs[key].map((item) => item.id)).size ===
          catalogs[key].length,
    );
  const valid =
    ready &&
    classification.version === catalogs.version &&
    axes.every(([axis, key]) =>
      catalogs[key].some((item) => item.id === classification[axis]),
    );
  return { ready, valid };
}
export function editorialPayload(classification, preferences, approve = false) {
  return {
    classification,
    editorialPreferences: preferences,
    ...(approve ? { approve: "EDITORIAL" } : {}),
  };
}
