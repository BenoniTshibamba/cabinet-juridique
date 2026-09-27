import { getSession, setSession, updateTokens } from './session.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// API backend. Le frontend peut être servi séparément (ex. Live Server sur :5500)
// tandis que l'API tourne sur http://localhost:4000.
const API_BASE_URL = (globalThis.__CEJ_API_URL__ || 'http://localhost:4000').replace(/\\/$/, '');

function apiUrl(path) {
  return `${API_BASE_URL}/api${path}`;
}

let refreshing = null;

async function doRefresh() {
  const session = getSession();
  if (!session?.refreshToken) throw new ApiError(401, 'no_session', 'Session expirée.');
  const res = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.accessToken || !body?.refreshToken) {
    // Ne supprime la session qu'après un vrai échec du refresh.
    setSession(null);
    throw new ApiError(res.status || 401, body?.error?.code ?? 'session_expired', body?.error?.message ?? 'Session expirée, veuillez vous reconnecter.');
  }
  updateTokens(body.accessToken, body.refreshToken);
  return body.accessToken;
}

let refreshing = null;

async function request(path, { method = 'GET', body, isForm = false, retry = true } = {}) {
  const makeRequest = async () => {
    const session = getSession();
    const headers = {};
    if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    let payload = body;
    if (body && !isForm) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    return fetch(apiUrl(path), { method, headers, body: payload });
  };

  let res = await makeRequest();

  if (res.status === 401 && retry && getSession()?.refreshToken) {
    refreshing ??= doRefresh().finally(() => { refreshing = null; });
    try {
      await refreshing;
      res = await makeRequest();
    } catch (err) {
      window.dispatchEvent(new CustomEvent('cej:session-expired'));
      throw err;
    }
  }

  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('cej:session-expired'));
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? res.statusText);
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, retry: false }),
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

  dashboard: () => request('/dashboard'),

  clients: (q = '') => request(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  client: (id) => request(`/clients/${id}`),
  createClient: (body) => request('/clients', { method: 'POST', body }),
  updateClient: (id, body) => request(`/clients/${id}`, { method: 'PATCH', body }),
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),

  cases: (params = {}) => request(`/cases?${new URLSearchParams(params)}`),
  case: (id) => request(`/cases/${id}`),
  createCase: (body) => request('/cases', { method: 'POST', body }),
  updateCase: (id, body) => request(`/cases/${id}`, { method: 'PATCH', body }),
  caseNotes: (id) => request(`/cases/${id}/notes`),
  addCaseNote: (id, content) => request(`/cases/${id}/notes`, { method: 'POST', body: { content } }),

  documents: (caseId) => request(`/cases/${caseId}/documents`),
  uploadDocument: (caseId, file) => {
    const form = new FormData();
    form.append('file', file);
    return request(`/cases/${caseId}/documents`, { method: 'POST', body: form, isForm: true });
  },
  deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),

  invoices: (params = {}) => request(`/invoices?${new URLSearchParams(params)}`),
  createInvoice: (body) => request('/invoices', { method: 'POST', body }),
  setInvoiceStatus: (id, status) => request(`/invoices/${id}/status`, { method: 'PATCH', body: { status } }),

  notifications: () => request('/notifications'),
  unreadCount: () => request('/notifications/unread-count'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request('/notifications/read-all', { method: 'POST' }),

  users: () => request('/users'),
  createUser: (body) => request('/users', { method: 'POST', body }),
  updateUser: (id, body) => request(`/users/${id}`, { method: 'PATCH', body }),

  auditLogs: (params = {}) => request(`/audit-logs?${new URLSearchParams(params)}`),

  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  publicPosts: () => request('/social/public/posts'),
  posts: () => request('/social/posts'),
  createPost: (body) => request('/social/posts', { method: 'POST', body }),
  updatePost: (id, body) => request(`/social/posts/${id}`, { method: 'PATCH', body }),
  deletePost: (id) => request(`/social/posts/${id}`, { method: 'DELETE' }),
  toggleLike: (id) => request(`/social/posts/${id}/like`, { method: 'POST' }),
  postComments: (id) => request(`/social/posts/${id}/comments`),
  addComment: (id, content) => request(`/social/posts/${id}/comments`, { method: 'POST', body: { content } }),
  messageUsers: () => request('/social/messages/users'),
  messages: (userId) => request(`/social/messages/${userId}`),
  sendMessage: (recipientId, content) => request('/social/messages', { method: 'POST', body: { recipientId, content } }),
  aiStatus: () => request('/ai/status'),
  askAI: (question, caseId) => request('/ai/ask', { method: 'POST', body: { question, ...(caseId ? { caseId } : {}) } }),
  indexDocument: (id) => request(`/ai/index-document/${id}`, { method: 'POST' }),
  registerRequest: (body) => request('/registration-requests', { method: 'POST', body }),
};

/**
 * Télécharge un fichier protégé (le jeton doit passer par l'en-tête Authorization, pas par l'URL)
 * et déclenche l'enregistrement côté navigateur.
 */
export async function downloadFile(path, fallbackName) {
  const session = getSession();
  const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${session?.accessToken ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'download_failed', 'Le téléchargement a échoué.');
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const name = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Comme downloadFile, mais ouvre le PDF dans un nouvel onglet plutôt que de l'enregistrer. */
export async function openFile(path) {
  const session = getSession();
  const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${session?.accessToken ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'open_failed', "L'ouverture du fichier a échoué.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
