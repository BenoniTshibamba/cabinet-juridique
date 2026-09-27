import { HttpError } from '../middleware/auth.js';

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'llama3:latest';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

async function ollamaFetch(path, body = undefined, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OLLAMA_HOST}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error || `Ollama a répondu avec HTTP ${response.status}.`;
      throw new HttpError(502, 'ollama_error', message);
    }
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err?.name === 'AbortError') {
      throw new HttpError(504, 'ollama_timeout', 'Ollama met trop de temps à répondre. Vérifiez que le modèle est bien chargé.');
    }
    throw new HttpError(503, 'ollama_unavailable', `Ollama est inaccessible sur ${OLLAMA_HOST}. Démarrez Ollama puis réessayez.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaStatus() {
  try {
    const data = await ollamaFetch('/api/tags', undefined, 5000);
    const models = Array.isArray(data?.models) ? data.models.map((m) => m.name) : [];
    return {
      available: true,
      host: OLLAMA_HOST,
      chatModel: CHAT_MODEL,
      embeddingModel: EMBED_MODEL,
      models,
      chatModelInstalled: models.some((name) => name === CHAT_MODEL || name.startsWith(`${CHAT_MODEL}:`)),
      embeddingModelInstalled: models.some((name) => name === EMBED_MODEL || name.startsWith(`${EMBED_MODEL}:`)),
    };
  } catch {
    return {
      available: false,
      host: OLLAMA_HOST,
      chatModel: CHAT_MODEL,
      embeddingModel: EMBED_MODEL,
      models: [],
      chatModelInstalled: false,
      embeddingModelInstalled: false,
    };
  }
}

export async function chat(messages, options = {}) {
  const data = await ollamaFetch('/api/chat', {
    model: options.model || CHAT_MODEL,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.2,
      num_predict: options.numPredict ?? 1800,
    },
  });
  const content = data?.message?.content;
  if (!content) throw new HttpError(502, 'ollama_empty_response', 'Ollama n’a pas généré de réponse.');
  return content;
}

export async function embed(text) {
  // /api/embeddings est conservé pour une compatibilité avec les versions Ollama
  // couramment utilisées dans le projet de chatbot d'origine.
  const data = await ollamaFetch('/api/embeddings', { model: EMBED_MODEL, prompt: text }, 120000);
  const vector = data?.embedding;
  if (!Array.isArray(vector) || !vector.length) {
    throw new HttpError(502, 'ollama_embedding_error', `Le modèle d’embeddings « ${EMBED_MODEL} » n’a pas retourné de vecteur.`);
  }
  return vector;
}

export const ollamaConfig = { host: OLLAMA_HOST, chatModel: CHAT_MODEL, embeddingModel: EMBED_MODEL };
