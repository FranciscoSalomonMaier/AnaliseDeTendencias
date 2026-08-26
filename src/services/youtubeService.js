const API_KEY = import.meta.env.VITE_YOUTUBE_V3_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

export async function getPopularVideos(regionCode = "BR") {
    const videoParams = new URLSearchParams({
        part: "snippet,statistics",
        chart: "mostPopular",
        regionCode,
        maxResults: "50",
        key: API_KEY,
    });
    
    const categoryParams = new URLSearchParams({
        part: "snippet",
        regionCode,
        key: API_KEY,
    });

    const [videosResponse, categoriesResponse] = await Promise.all ([
        fetch(`${BASE_URL}/videos?${videoParams}`),
        fetch(`${BASE_URL}/videoCategories?${categoryParams}`),
    ]);

    if (!videosResponse.ok) {
        throw new Error("Erro ao buscar vídeos do YouTube");
    }

    if (!categoriesResponse.ok) {
        throw new Error("Erro ao buscar categorias do YouTube");
    }

    const videosData = await videosResponse.json();
    const categoriesData = await categoriesResponse.json();

    const categoriesMap = Object.fromEntries(
        categoriesData.items.map((category) => [
            category.id,
            category.snippet.title
        ])
    );



    return videosData.items.map((video) => ({
        ...video,
        numberView: formatNumberView(video.statistics.viewCount),
        categoryTitle:
            categoriesMap[video.snippet.categoryId] ?? "Categoria desconhecida",
    }));
}

function formatNumberView(value) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toString();
}