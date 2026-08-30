const API_URL = import.meta.env.VITE_API_URL;

export async function getApiStatus() {
    const response = await fetch(`${API_URL}/status`);

    if (!response.ok) {
        throw new Error('Erro ao acessar a API');
    }

    return response.json();
}