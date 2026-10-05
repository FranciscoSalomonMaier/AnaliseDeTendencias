const API_URL = import.meta.env.VITE_API_URL;

export async function getPopularVideos(regionCode = "BR", period = "today", signal) {
  const params = new URLSearchParams({
    regionCode,
    period,
  });

  const response = await fetch(`${API_URL}/youtube/popular?${params}`, { signal });

  if (!response.ok) {
    throw new Error("Erro ao buscar vídeos");
  }

  return response.json();
}

export async function getAnalyzedVideos(regionCode = "BR") {
  const params = new URLSearchParams({ regionCode });
  const response = await fetch(`${API_URL}/trends/youtube?${params}`);

  if (!response.ok) {
    throw new Error("Erro ao buscar tendências analisadas");
  }

  return response.json();
}

export async function getGroupedYoutubeTrends(regionCode = "BR") {
  const params = new URLSearchParams({ regionCode });
  const response = await fetch(`${API_URL}/trends/youtube/grouped?${params}`);

  if (!response.ok) {
    throw new Error("Erro ao buscar grupos de tendências");
  }

  return response.json();
}
