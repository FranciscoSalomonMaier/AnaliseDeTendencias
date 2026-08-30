const API_URL = import.meta.env.VITE_API_URL;

export async function getPopularVideos(regionCode = "BR") {
    const params = new URLSearchParams({
        regionCode,
    });

    const response = await fetch(
        `${API_URL}/youtube/popular?${params}`,
    )

    if (!response.ok) {
        throw new Error('Erro ao buscar vídeos');
    }

    return response.json();
}