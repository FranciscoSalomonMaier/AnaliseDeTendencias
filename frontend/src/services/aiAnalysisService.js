const API_URL = import.meta.env.VITE_API_URL;

export async function getLatestAiAnalysis(regionCode = "BR") {
  const query = new URLSearchParams({ regionCode });
  const response = await fetch(
    `${API_URL}/trends/youtube/ai-analysis/latest?${query}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Falha ao consultar a última análise");
  return response.json();
}

export async function generateAiAnalysis(regionCode = "BR", force = false) {
  const query = new URLSearchParams({ regionCode });
  if (force) query.set("force", "true");
  const response = await fetch(
    `${API_URL}/trends/youtube/ai-analysis?${query}`,
    {
      method: "POST",
    },
  );
  if (!response.ok) {
    const fallback =
      response.status === 429
        ? "Limite de requisições atingido. Tente mais tarde."
        : "Não foi possível gerar a análise agora.";
    let message = fallback;
    try {
      const error = await response.json();
      if (typeof error.message === "string" && error.message.trim()) {
        message = error.message;
      }
    } catch {
      // Mantém a mensagem segura quando o servidor não retorna JSON.
    }
    throw new Error(message);
  }
  return response.json();
}
