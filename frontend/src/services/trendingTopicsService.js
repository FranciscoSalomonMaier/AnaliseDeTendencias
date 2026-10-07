const API_URL = import.meta.env.VITE_API_URL;

export async function getTrendingTopics({ period = "today", regionCode = "BR", limit = 20, signal } = {}) {
  const params = new URLSearchParams({ period, regionCode, limit: String(limit) });
  const response = await fetch(`${API_URL}/trends/youtube/topics?${params}`, { signal });
  if (!response.ok) throw new Error("Não foi possível carregar os temas em alta.");
  return response.json();
}
