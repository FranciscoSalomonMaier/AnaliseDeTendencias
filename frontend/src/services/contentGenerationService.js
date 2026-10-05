const API_URL = import.meta.env.VITE_API_URL;

/** @typedef {import('../types/contentGeneration').ContentIdea} ContentIdea */
/** @typedef {import('../types/contentGeneration').GeneratedScript} GeneratedScript */
/** @typedef {import('../types/contentGeneration').GeneratedVideoPlan} GeneratedVideoPlan */
/** @typedef {import('../types/contentGeneration').ContentGenerationContext} ContentGenerationContext */
/** @typedef {import('../types/contentGeneration').ContentGenerationListResponse} ContentGenerationListResponse */
/** @typedef {import('../types/contentGeneration').GenerateContentIdeasOptions} GenerateContentIdeasOptions */

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = 'Não foi possível concluir esta etapa.';
    try {
      const error = await response.json();
      if (typeof error.message === 'string') message = error.message;
      else if (Array.isArray(error.message)) message = error.message.join(' ');
    } catch {
      // Mantém a mensagem genérica quando a API não retorna JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

/** @param {GenerateContentIdeasOptions} options @returns {Promise<ContentIdea[]>} */
export function generateContentIdeas({ trendId, referenceVideoId, regionCode = 'BR', language = 'pt-BR', durationPreference, additionalInstructions }) {
  const query = new URLSearchParams({ regionCode, language });
  return request(`/trends/${encodeURIComponent(trendId)}/content/ideas?${query}`, {
    method: 'POST',
    body: JSON.stringify({ referenceVideoId, durationPreference, additionalInstructions }),
  });
}

/** @param {ContentIdea} idea @returns {Promise<GeneratedScript>} */
export function generateContentScript(idea) {
  return request('/trends/content/script', {
    method: 'POST',
    body: JSON.stringify(idea),
  });
}

/** @param {GeneratedScript} script @returns {Promise<GeneratedVideoPlan>} */
export function generateContentScenes(script) {
  return request('/trends/content/scenes', {
    method: 'POST',
    body: JSON.stringify(script),
  });
}

/** @param {string} generationId @returns {Promise<ContentGenerationContext>} */
export function getContentGeneration(generationId) {
  return request(`/trends/content/${encodeURIComponent(generationId)}`);
}

/** @param {{ regionCode?: string, limit?: number, offset?: number }} [options] @returns {Promise<ContentGenerationListResponse>} */
export function listContentGenerations({ regionCode, limit = 50, offset = 0 } = {}) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (regionCode) query.set('regionCode', regionCode);
  return request(`/trends/content?${query}`);
}

/** @param {string} generationId @param {ContentIdea} idea @returns {Promise<ContentIdea>} */
export function selectContentIdea(generationId, idea) {
  return request(`/trends/content/${encodeURIComponent(generationId)}/selection`, {
    method: 'PATCH',
    body: JSON.stringify({ idea }),
  });
}

/** @param {string} generationId @param {GeneratedScript} script @returns {Promise<GeneratedScript>} */
export function saveReviewedContentScript(generationId, script) {
  return request(`/trends/content/${encodeURIComponent(generationId)}/script`, {
    method: 'PATCH',
    body: JSON.stringify({ script }),
  });
}

/** @param {string} generationId @param {GeneratedScript} script @param {GeneratedVideoPlan} videoPlan @param {boolean} [approved] @returns {Promise<GeneratedVideoPlan>} */
export function saveReviewedContentPlan(generationId, script, videoPlan, approved = false) {
  return request(`/trends/content/${encodeURIComponent(generationId)}/plan`, {
    method: 'PATCH',
    body: JSON.stringify({ script, videoPlan, approved }),
  });
}
