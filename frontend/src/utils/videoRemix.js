export const remixStatusLabels = {
  DRAFT: "Rascunho",
  SOURCES_PENDING: "Fontes pendentes",
  ANALYZING: "Analisando",
  SCRIPTING: "Roteirizando",
  RENDERING: "Renderizando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};

export const remixAuthorizationLabels = {
  UNKNOWN: "A verificar",
  OWNED: "Conteúdo próprio",
  AUTHORIZED: "Uso autorizado",
  PUBLIC_DOMAIN: "Domínio público",
};

export function remixTimestamp(seconds) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}
