const API_URL = import.meta.env.VITE_API_URL;

export async function getPopularVideos(regionCode = "BR") {
  const params = new URLSearchParams({
    regionCode,
  });

  const response = await fetch(`${API_URL}/youtube/popular?${params}`);

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
