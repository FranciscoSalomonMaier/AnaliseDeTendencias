export const projectStatusLabels = {
  DRAFT: "Configuração",
  IDEAS_GENERATED: "Ideias geradas",
  IDEA_SELECTED: "Ideia selecionada",
  SCRIPT_GENERATED: "Roteiro em revisão",
  SCRIPT_APPROVED: "Roteiro aprovado",
  SCENES_GENERATED: "Cenas em revisão",
  SCENES_APPROVED: "Cenas aprovadas",
};
export function projectStep(project) {
  if (!project || project.status === "DRAFT") return "config";
  if (project.status === "SCENES_APPROVED") return "production";
  if (project.status === "SCENES_GENERATED") return "scenes";
  if (["SCRIPT_GENERATED", "SCRIPT_APPROVED"].includes(project.status))
    return "script";
  return "idea";
}
export function canGenerateScenes(project) {
  return Boolean(
    project?.script &&
    !project.scriptStale &&
    ["SCRIPT_APPROVED", "SCENES_GENERATED", "SCENES_APPROVED"].includes(
      project.status,
    ),
  );
}
export function validProjectSteps(project) {
  return {
    config: true,
    idea: Boolean(
      project && project.status !== "DRAFT" && project.ideas.length,
    ),
    script: Boolean(project?.script && !project.scriptStale),
    scenes: Boolean(project?.scenes.length && !project.scenesStale),
    production: project?.status === "SCENES_APPROVED",
  };
}
