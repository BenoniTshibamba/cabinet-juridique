/* --- dom.js --- */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}
const clear = (el) => (el.replaceChildren(), el);


/* --- icons.js --- */
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z',
  clients: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 8a3 3 0 1 1 0 6M16 14c2.5 0 5 1.8 5 6',
  cases: 'M4 7h16v13H4zM4 7l2-3h12l2 3M9 11h6',
  documents: 'M7 3h7l4 4v14H7zM14 3v4h4M9 13h6M9 16h6',
  billing: 'M4 6h16v12H4zM4 10h16M8 15h3',
  messages: 'M4 5h16v11H8l-4 4z',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0',
  audit: 'M5 4h14v16H5zM9 4v16M13 9h4M13 13h4M13 17h4',
  users: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.3 2.6-6 6-6s6 2.7 6 6M16 8a3 3 0 1 1 0 6M16 14c2.5 0 6 1.5 6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  chevronDown: 'm6 9.5 6 6 6-6',
  chevronLeft: 'm14.5 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 4H5v16h4M14 8l4 4-4 4M18 12H9',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5 3.5 3.5M19 19l-1.5-1.5M5 19l-1.5 1.5M19 5l1.5-1.5M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  download: 'M12 4v11M7 11l5 5 5-5M5 19h14',
  trash: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13',
  check: 'm5 12 5 5 9-9',
  close: 'm6 6 12 12M18 6 6 18',
  file: 'M7 3h7l4 4v14H7z',
};
function icon(name, cls = 'icon') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? '');
  svg.append(path);
  return svg;
}


/* --- session.js --- */
// Session : le jeton d'accès et le refresh token sont conservés en mémoire + localStorage
// pour survivre à un rechargement de page. Dans un déploiement de production, on préférerait
// un cookie httpOnly signé côté serveur ; ce choix est documenté dans le README (simplicité de démo).
const KEY = 'cej:session';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

let session = read();

const getSession = () => session;
const getUser = () => session?.user ?? null;

function setSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : la session reste valable pour cet onglet */
  }
}

function updateTokens(accessToken, refreshToken) {
  if (!session) return;
  setSession({ ...session, accessToken, refreshToken });
}


/* --- api.js --- */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// API backend. Le frontend peut être servi séparément (ex. Live Server sur :5500)
// tandis que l'API tourne sur http://localhost:4000.
const API_BASE_URL = (globalThis.__CEJ_API_URL__ || `${location.protocol}//${location.host}`).replace(/\/$/, '');

function apiUrl(path) {
  return `${API_BASE_URL}/api${path}`;
}

/** URL absolue vers un fichier servi statiquement (hors /api), ex. une image de publication. */
function mediaUrl(path) {
  return path ? `${API_BASE_URL}${path}` : null;
}

let refreshing = null;

async function doRefresh() {
  const current = getSession();
  if (!current?.refreshToken) throw new ApiError(401, 'no_session', 'Aucune session active.');
  const res = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.accessToken) {
    // Ne supprime jamais la session ici. Une erreur réseau temporaire ne doit
    // pas déconnecter l'utilisateur. La route de navigation décide ensuite
    // si la session est réellement invalide.
    throw new ApiError(res.status || 401, body?.error?.code ?? 'refresh_failed', body?.error?.message ?? 'Impossible de renouveler la session.');
  }
  // Le backend peut retourner ou non un nouveau refresh token.
  updateTokens(body.accessToken, body.refreshToken || current.refreshToken);
  return body.accessToken;
}

async function request(path, { method = 'GET', body, isForm = false, retry = true } = {}) {
  const makeRequest = async () => {
    const current = getSession();
    const headers = {};
    if (current?.accessToken) headers.Authorization = `Bearer ${current.accessToken}`;
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
      // Une seule requête décide de déconnecter après un refresh réellement
      // refusé. Les erreurs réseau restent affichées sans effacer la session.
      if (err?.status === 401 && err?.code === 'invalid_refresh') {
        setSession(null);
        window.dispatchEvent(new CustomEvent('cej:session-expired'));
      }
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

const api = {
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
  createPost: (body, imageFile) => {
    if (!imageFile) return request('/social/posts', { method: 'POST', body });
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    form.append('image', imageFile);
    return request('/social/posts', { method: 'POST', body: form, isForm: true });
  },
  updatePost: (id, body, imageFile, removeImage = false) => {
    if (!imageFile && !removeImage) return request(`/social/posts/${id}`, { method: 'PATCH', body });
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    if (imageFile) form.append('image', imageFile);
    if (removeImage) form.append('removeImage', 'true');
    return request(`/social/posts/${id}`, { method: 'PATCH', body: form, isForm: true });
  },
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
async function downloadFile(path, fallbackName) {
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
async function openFile(path) {
  const session = getSession();
  const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${session?.accessToken ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'open_failed', "L'ouverture du fichier a échoué.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}


/* --- app.js --- */

const root = document.getElementById('root');

/* ------------------------------------------------------------------ */
/* Aides générales                                                     */
/* ------------------------------------------------------------------ */

const $ = (sel, r = document) => r.querySelector(sel);

let toastTimer;
function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3200);
}

const fmtMoney = (cents) => (cents / 100).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
const fmtMoneyShort = (cents) => (cents / 100).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-CA') : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('fr-CA') : '—');
const initials = (first, last) => `${(first?.[0] ?? '').toUpperCase()}${(last?.[0] ?? '').toUpperCase()}`;

const CASE_STATUS = { NOUVEAU: 'Nouveau', EN_COURS: 'En cours', EN_ATTENTE: 'En attente', TERMINE: 'Terminé', ARCHIVE: 'Archivé' };
const CASE_PRIORITY = { BASSE: 'Basse', NORMALE: 'Normale', HAUTE: 'Haute', URGENTE: 'Urgente' };
const INVOICE_STATUS = {
  BROUILLON: 'Brouillon', ENVOYEE: 'Envoyée', PAYEE: 'Payée',
  PARTIELLEMENT_PAYEE: 'Partiellement payée', EN_RETARD: 'En retard', ANNULEE: 'Annulée',
};
const ROLE_LABEL = {
  SUPER_ADMIN: 'Super administrateur', ADMIN: 'Administrateur', LAWYER: 'Avocat',
  ASSISTANT: 'Assistant', ACCOUNTANT: 'Comptable', CLIENT: 'Client',
};

function statusDot(status, map) {
  return h('span', { class: `status status-${status}` }, h('span', { class: 'status-dot' }), map[status] ?? status);
}

function errorMessage(err) {
  return err instanceof ApiError ? err.message : 'Une erreur est survenue. Veuillez réessayer.';
}

async function guarded(fn, { onError } = {}) {
  try {
    return await fn();
  } catch (err) {
    (onError ?? toast)(errorMessage(err), 'error');
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Modale générique                                                    */
/* ------------------------------------------------------------------ */

function openModal(title, contentEl, { wide = false } = {}) {
  const overlay = h(
    'div',
    { class: 'overlay', onclick: (e) => e.target === overlay && close() },
    h(
      'div',
      { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => close() }, icon('close'))),
      contentEl,
    ),
  );
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return close;
}

function field(labelText, inputEl) {
  return h('label', { class: 'field' }, h('span', null, labelText), inputEl);
}

/* ------------------------------------------------------------------ */
/* Routage                                                             */
/* ------------------------------------------------------------------ */

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'home', id: parts[1] };
}

let currentUser = null;

async function route() {
  const { name, id } = parseHash();

  // La connexion est une vraie route. Cela évite les boutons qui ne déclenchent
  // rien et permet d'ouvrir directement la page de connexion via #/login.
  if (name === 'login') {
    return renderLogin();
  }

  const session = getSession();

  // L'accueil est désormais la même page publique avant et après connexion.
  // Nous n'appelons volontairement pas /me ici : l'utilisateur vient de se connecter
  // et son identité/permissions sont déjà stockées dans la session locale. Cela évite
  // qu'une erreur de refresh/token fasse disparaître l'accueil.
  if (!session?.user?.id) {
    currentUser = null;
    return renderPublicHome(null);
  }

  currentUser = session.user;
  if (!name || name === 'home' || name === 'social') {
    return renderPublicHome(currentUser);
  }

  // Les autres écrans restent privés et utilisent /me pour vérifier la session.
  try {
    currentUser = await api.me();
  } catch (err) {
    const cached = getSession()?.user;
    if (cached?.id && Array.isArray(cached.permissions)) {
      currentUser = cached;
    } else {
      setSession(null);
      currentUser = null;
      return renderPublicHome(null);
    }
  }

  const perms = new Set(currentUser.permissions ?? []);
  renderShell(perms);
  const main = $('#main');
  clear(main).append(h('p', { class: 'loading' }, 'Chargement…'));

  const views = {
    dashboard: () => viewDashboard(main),
    messages: () => viewMessages(main),
    ai: () => viewAI(main),
    clients: () => (id ? viewClientDetail(main, id) : viewClients(main)),
    cases: () => (id ? viewCaseDetail(main, id) : viewCases(main)),
    invoices: () => viewInvoices(main),
    users: () => viewUsers(main),
    audit: () => viewAudit(main),
  };
  (views[name] ?? views.dashboard)();
  highlightNav(name);
}

window.addEventListener('hashchange', route);
window.addEventListener('cej:session-expired', () => {
  setSession(null);
  currentUser = null;
  toast('Votre session a expiré. Vous êtes revenu à l’accueil.', 'error');
  renderPublicHome(null);
});

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */


/** Fait défiler la page jusqu'à une section, sans passer par le routeur (qui écoute #hashchange). */
function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const LANG_KEY = 'cej:lang';
function getLang() {
  try { return localStorage.getItem(LANG_KEY) || 'fr'; } catch { return 'fr'; }
}
function setLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
}
function toggleLang() {
  setLang(getLang() === 'fr' ? 'en' : 'fr');
  route();
}

/** Dictionnaire de traduction de la page d'accueil publique (FR/EN). */
const I18N = {
  fr: {
    topbarHours: 'Lundi–Vendredi | 9h00–18h00',
    navHome: 'Accueil',
    navDomains: 'Domaines d’intervention',
    navPublications: 'Publications',
    navContact: 'Contact',
    brand: 'Cabinet Élite Juridique',
    monEspace: 'Mon espace',
    ajouterPublication: 'Ajouter une publication',
    seConnecter: 'Se connecter',
    seDeconnecter: 'Se déconnecter',
    demanderAcces: 'Demander un accès',
    kicker: 'CABINET ÉLITE JURIDIQUE',
    heroTitle: 'Votre partenaire pour vos besoins juridiques',
    heroText: 'Retrouvez nos actualités, articles et publications. Les membres autorisés peuvent également accéder à leurs dossiers, documents, messages et à l’assistant documentaire.',
    rejoindre: 'Rejoindre la plateforme',
    voirPublications: 'Voir les publications',
    domainsTitle: 'Domaines d’intervention',
    domainsIntro: 'Notre cabinet couvre un éventail de domaines juridiques afin d’accompagner autant les particuliers que les entreprises. Chaque dossier est traité avec la même rigueur, quelle que soit sa complexité, et notre équipe s’assure de vous orienter vers la ressource la mieux adaptée à votre situation. Cliquez sur un domaine ci-dessous pour en savoir plus. — Texte à personnaliser selon votre pratique.',
    enSavoirPlus: 'En savoir plus →',
    publicationsTitle: 'Actualités et publications',
    publicationsIntro: 'Retrouvez ici les analyses, mises à jour légales et réflexions publiées par notre équipe. Nous partageons régulièrement du contenu pour vous aider à mieux comprendre vos droits et les enjeux juridiques qui touchent votre quotidien ou votre entreprise. Les membres inscrits peuvent également commenter, réagir et échanger directement avec les auteurs. — Texte à personnaliser selon votre pratique.',
    aucunePublication: 'Aucune publication pour le moment.',
    publicationsBientot: 'Les publications seront disponibles prochainement.',
    chargementPublications: 'Chargement des publications…',
    contactTitle: 'Contact',
    contactIntro: 'Une question, un dossier à démarrer ou simplement besoin d’un premier avis ? Notre équipe est disponible pour vous écouter et vous orienter vers la bonne ressource au sein du cabinet. Écrivez-nous ou appelez-nous aux coordonnées ci-dessous, et nous vous répondrons dans les meilleurs délais. — Texte à personnaliser selon votre pratique.',
    adresseLabel: 'Adresse',
    telephoneLabel: 'Téléphone',
    courrielLabel: 'Courriel',
    adresseValue: '123, rue du Cabinet, Montréal, Québec',
    telephoneValue: '+1 (514) 555-0123',
    courrielValue: 'contact@cabinet-elite.example',
    footerDomainsTitle: 'Domaines d’intervention',
    footerAccessTitle: 'Accès',
    footerRights: '© Cabinet Élite Juridique',
    footerInfo: 'Informations générales',
    seConnecterPourInteragir: 'Se connecter pour interagir',
    article: 'Article',
    publication: 'Publication',
    ceQuOnPeutPreparer: 'Ce que nous pouvons vous accompagner à préparer',
    preparerList: ['Analyse et organisation des informations du dossier', 'Préparation des documents et prochaines étapes', 'Échanges avec l’équipe du cabinet'],
    nousContacter: 'Nous contacter',
    changerTheme: 'Changer de thème',
    changerLangue: 'Switch to English',
  },
  en: {
    topbarHours: 'Monday–Friday | 9:00 AM–6:00 PM',
    navHome: 'Home',
    navDomains: 'Practice Areas',
    navPublications: 'Publications',
    navContact: 'Contact',
    brand: 'Cabinet Élite Juridique',
    monEspace: 'My Workspace',
    ajouterPublication: 'Add a Post',
    seConnecter: 'Log In',
    seDeconnecter: 'Log Out',
    demanderAcces: 'Request Access',
    kicker: 'CABINET ÉLITE JURIDIQUE',
    heroTitle: 'Your Partner for Legal Matters',
    heroText: 'Browse our news, articles and publications. Authorized members can also access their cases, documents, messages and the document assistant.',
    rejoindre: 'Join the Platform',
    voirPublications: 'View Publications',
    domainsTitle: 'Practice Areas',
    domainsIntro: 'Our firm covers a range of legal practice areas to support both individuals and businesses. Every file is handled with the same rigor, regardless of complexity, and our team makes sure you are directed to the right resource for your situation. Click on an area below to learn more. — Placeholder text, edit to match your practice.',
    enSavoirPlus: 'Learn more →',
    publicationsTitle: 'News & Publications',
    publicationsIntro: 'Find our team’s analyses, legal updates and insights here. We regularly share content to help you better understand your rights and the legal issues that affect your daily life or business. Registered members can also comment, react and engage directly with the authors. — Placeholder text, edit to match your practice.',
    aucunePublication: 'No publications yet.',
    publicationsBientot: 'Publications will be available soon.',
    chargementPublications: 'Loading publications…',
    contactTitle: 'Contact',
    contactIntro: 'A question, a new matter to open, or just need a first opinion? Our team is available to listen and direct you to the right resource within the firm. Write or call us using the details below, and we’ll get back to you as soon as possible. — Placeholder text, edit to match your practice.',
    adresseLabel: 'Address',
    telephoneLabel: 'Phone',
    courrielLabel: 'Email',
    adresseValue: '123 Firm Street, Montréal, Québec',
    telephoneValue: '+1 (514) 555-0123',
    courrielValue: 'contact@cabinet-elite.example',
    footerDomainsTitle: 'Practice Areas',
    footerAccessTitle: 'Access',
    footerRights: '© Cabinet Élite Juridique',
    footerInfo: 'General Information',
    seConnecterPourInteragir: 'Log in to interact',
    article: 'Article',
    publication: 'Post',
    ceQuOnPeutPreparer: 'What we can help you prepare',
    preparerList: ['Reviewing and organizing your file’s information', 'Preparing documents and next steps', 'Communication with the firm’s team'],
    nousContacter: 'Contact Us',
    changerTheme: 'Toggle theme',
    changerLangue: 'Passer en français',
  },
};
function t(key) {
  const lang = getLang();
  return I18N[lang]?.[key] ?? I18N.fr[key];
}

const PRACTICE_AREAS = [
  {
    icon: '🏢',
    fr: {
      title: 'Droit des affaires',
      text: 'Constitution de sociétés, contrats commerciaux, fusions & acquisitions, conformité.',
      long: 'Notre équipe accompagne les entrepreneurs et les entreprises à chaque étape de leur développement : choix de la structure juridique, rédaction et négociation de contrats commerciaux, opérations de fusion et d’acquisition, ainsi que la mise en conformité réglementaire. Nous visons à sécuriser vos décisions d’affaires tout en gardant une approche pratique et adaptée à la réalité de votre organisation. — Texte à personnaliser selon votre pratique.',
    },
    en: {
      title: 'Business Law',
      text: 'Incorporation, commercial contracts, mergers & acquisitions, compliance.',
      long: 'Our team supports entrepreneurs and businesses at every stage of their development: choosing the right legal structure, drafting and negotiating commercial contracts, mergers and acquisitions, and regulatory compliance. We aim to secure your business decisions while keeping a practical approach suited to your organization’s reality. — Placeholder text, edit to match your practice.',
    },
  },
  {
    icon: '👪',
    fr: {
      title: 'Droit de la famille',
      text: 'Divorce, filiation, adoption, succession et protection des personnes.',
      long: 'Les dossiers familiaux touchent souvent des moments personnels délicats. Notre cabinet offre un accompagnement humain et rigoureux pour les procédures de divorce et de séparation, les questions de filiation et d’adoption, la planification successorale, ainsi que la protection des personnes vulnérables. Nous cherchons des solutions qui protègent vos intérêts tout en limitant les conflits. — Texte à personnaliser selon votre pratique.',
    },
    en: {
      title: 'Family Law',
      text: 'Divorce, filiation, adoption, estates, and protection of persons.',
      long: 'Family matters often touch on sensitive personal moments. Our firm offers thorough, human support for divorce and separation proceedings, filiation and adoption matters, estate planning, and the protection of vulnerable persons. We seek solutions that protect your interests while limiting conflict. — Placeholder text, edit to match your practice.',
    },
  },
  {
    icon: '⚙️',
    fr: {
      title: 'Droit du travail',
      text: 'Contrats de travail, licenciements, négociations collectives, sécurité sociale.',
      long: 'Nous conseillons employeurs et employés sur l’ensemble des enjeux liés à la relation de travail : rédaction de contrats, gestion des licenciements, négociations collectives et questions de sécurité sociale. Notre objectif est de prévenir les litiges autant que possible, et de défendre vos droits efficacement lorsqu’un conflit survient. — Texte à personnaliser selon votre pratique.',
    },
    en: {
      title: 'Employment Law',
      text: 'Employment contracts, terminations, collective bargaining, social security.',
      long: 'We advise both employers and employees on all aspects of the employment relationship: drafting contracts, managing terminations, collective bargaining, and social security matters. Our goal is to prevent disputes wherever possible, and to defend your rights effectively when a conflict arises. — Placeholder text, edit to match your practice.',
    },
  },
  {
    icon: '⚖️',
    fr: {
      title: 'Contentieux & Arbitrage',
      text: 'Représentation devant les tribunaux, médiation et arbitrage commercial.',
      long: 'Lorsqu’un différend ne peut être résolu à l’amiable, notre équipe vous représente devant les tribunaux ainsi que dans les processus de médiation et d’arbitrage commercial. Nous élaborons une stratégie adaptée à chaque dossier, en cherchant toujours l’issue la plus favorable et la plus efficace pour nos clients. — Texte à personnaliser selon votre pratique.',
    },
    en: {
      title: 'Litigation & Arbitration',
      text: 'Court representation, mediation, and commercial arbitration.',
      long: 'When a dispute cannot be resolved amicably, our team represents you before the courts as well as in mediation and commercial arbitration proceedings. We build a strategy tailored to each case, always seeking the most favorable and efficient outcome for our clients. — Placeholder text, edit to match your practice.',
    },
  },
];
function pa(area) { return area[getLang()] ?? area.fr; }

function openPracticeModal(area) {
  const a = pa(area);
  const body = h('div', { class: 'stacked-form' },
    h('p', { class: 'muted' }, a.long ?? a.text),
    h('h3', null, t('ceQuOnPeutPreparer')),
    h('ul', null, ...t('preparerList').map((li) => h('li', null, li))),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { close(); scrollToId('contact'); } }, t('nousContacter'))
  );
  const close = openModal(a.title, body);
}

async function renderPublicHome(loggedUser = null) {
  document.title = `${t('navHome')} — ${t('brand')}`;
  // root est entièrement remplacé ci-dessous : si l'utilisateur retourne ensuite au
  // tableau de bord, renderShell() doit se reconstruire en entier plutôt que de
  // supposer que ses éléments (#user-name, etc.) existent encore dans le DOM.
  shellBuilt = false;

  const topbar = h('div', { class: 'public-topbar' },
    h('div', { class: 'public-topbar-contact' },
      h('span', null, `✉ ${t('courrielValue')}`),
      h('span', null, `☎ ${t('telephoneValue')}`),
      h('span', null, t('topbarHours')),
    ),
  );

  const navItems = [
    { label: t('navHome'), onclick: () => scrollToId('accueil') },
    { label: t('navDomains'), onclick: () => scrollToId('domaines') },
    { label: t('navPublications'), onclick: () => scrollToId('publications') },
    { label: t('navContact'), onclick: () => scrollToId('contact') },
  ];

  const header = h('header', { class: 'public-header' },
    h('div', { class: 'public-brand' },
      h('span', { class: 'brand-mark' }, '⚖'),
      h('span', null, t('brand'))
    ),
    h('nav', { class: 'public-nav' },
      ...navItems.map((n) => h('button', { class: 'public-nav-link', type: 'button', onclick: n.onclick }, n.label))
    ),
    h('div', { class: 'public-header-actions' },
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': t('changerTheme'), title: t('changerTheme'),
        onclick: toggleTheme,
      }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')),
      h('button', {
        class: 'btn btn-secondary lang-toggle', type: 'button', 'aria-label': t('changerLangue'), title: t('changerLangue'),
        onclick: toggleLang,
      }, getLang() === 'fr' ? 'EN' : 'FR'),
      loggedUser
        ? [
            h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { location.hash = '#/dashboard'; await route(); } }, t('monEspace')),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openPostModal() }, icon('plus'), t('ajouterPublication')),
          ]
        : h('button', { class: 'btn btn-primary login-top-btn', type: 'button', onclick: () => { location.hash = '#/login'; } }, t('seConnecter'))
    )
  );

  const hero = h('section', { class: 'public-hero', id: 'accueil' },
    h('div', { class: 'public-hero-content' },
      h('span', { class: 'public-kicker' }, t('kicker')),
      h('h1', null, t('heroTitle')),
      h('p', null, t('heroText')),
      h('div', { class: 'public-hero-actions' },
        !loggedUser ? h('button', { class: 'btn btn-primary', type: 'button', onclick: openRegistrationModal }, t('rejoindre')) : null,
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => scrollToId('publications') }, t('voirPublications'))
      )
    )
  );

  const practiceSection = h('section', { class: 'public-section', id: 'domaines' },
    h('div', { class: 'public-section-head' },
      h('div', null,
        h('h2', null, t('domainsTitle')),
        h('p', { class: 'muted' }, t('domainsIntro'))
      )
    ),
    h('div', { class: 'practice-grid' },
      ...PRACTICE_AREAS.map((area) => {
        const a = pa(area);
        return h('article', { class: 'panel practice-card' },
          h('span', { class: 'practice-icon' }, area.icon),
          h('h3', null, a.title),
          h('p', { class: 'muted' }, a.text),
          h('button', { class: 'link-btn', type: 'button', onclick: () => openPracticeModal(area) }, t('enSavoirPlus'))
        );
      })
    )
  );

  const feed = h('div', { class: 'public-feed' }, h('p', { class: 'loading' }, t('chargementPublications')));

  const publicationsSection = h('section', { class: 'public-section', id: 'publications' },
    h('div', { class: 'public-section-head' },
      h('div', null,
        h('h2', null, t('publicationsTitle')),
        h('p', { class: 'muted' }, t('publicationsIntro'))
      ),
      !loggedUser ? h('button', { class: 'btn btn-primary', type: 'button', onclick: openRegistrationModal }, t('rejoindre')) : null
    ),
    feed
  );

  const contactSection = h('section', { class: 'public-section public-contact', id: 'contact' },
    h('div', { class: 'public-section-head' },
      h('div', null,
        h('h2', null, t('contactTitle')),
        h('p', { class: 'muted' }, t('contactIntro'))
      )
    ),
    h('div', { class: 'panel contact-panel' },
      h('div', { class: 'contact-detail' }, h('strong', null, t('adresseLabel')), h('span', null, t('adresseValue'))),
      h('div', { class: 'contact-detail' }, h('strong', null, t('telephoneLabel')), h('span', null, t('telephoneValue'))),
      h('div', { class: 'contact-detail' }, h('strong', null, t('courrielLabel')), h('span', null, t('courrielValue'))),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: openRegistrationModal }, t('demanderAcces'))
    )
  );

  const footer = h('footer', { class: 'public-footer' },
    h('div', { class: 'public-footer-grid' },
      h('div', { class: 'public-footer-col' },
        h('div', { class: 'public-brand' }, h('span', { class: 'brand-mark' }, '⚖'), h('span', null, t('brand'))),
        h('p', { class: 'muted' }, t('adresseValue')),
        h('p', { class: 'muted' }, `${t('telephoneValue')} · ${t('courrielValue')}`)
      ),
      h('div', { class: 'public-footer-col' },
        h('h4', null, t('footerDomainsTitle')),
        ...PRACTICE_AREAS.map((area) => h('button', { class: 'link-btn', type: 'button', onclick: () => scrollToId('domaines') }, pa(area).title))
      ),
      h('div', { class: 'public-footer-col' },
        h('h4', null, t('footerAccessTitle')),
        h('button', { class: 'link-btn', type: 'button', onclick: () => scrollToId('publications') }, t('navPublications')),
        h('button', { class: 'link-btn', type: 'button', onclick: () => scrollToId('contact') }, t('navContact')),
        loggedUser
          ? h('button', { class: 'link-btn', type: 'button', onclick: logout }, t('seDeconnecter'))
          : h('button', { class: 'link-btn', type: 'button', onclick: () => { location.hash = '#/login'; } }, t('seConnecter')),
        !loggedUser ? h('button', { class: 'link-btn', type: 'button', onclick: openRegistrationModal }, t('demanderAcces')) : null
      )
    ),
    h('div', { class: 'public-footer-bottom' },
      h('span', null, t('footerRights')),
      h('span', null, t('footerInfo'))
    ),
    h('div', { class: 'public-footer-credit' }, 'BUILD WITH LOVE AND CAFFEINE BY BB24')
  );

  clear(root).append(
    h('div', { class: 'public-home' },
      topbar,
      header,
      hero,
      h('main', { class: 'public-main' }, practiceSection, publicationsSection, contactSection),
      footer
    )
  );

  const posts = await guarded(() => (loggedUser ? api.posts() : api.publicPosts()), { onError: () => {
    clear(feed).append(h('section', { class: 'panel' },
      h('p', { class: 'empty-state' }, t('publicationsBientot'))
    ));
  }});
  if (!posts) return;

  clear(feed);
  if (!posts.length) {
    feed.append(h('section', { class: 'panel' },
      h('p', { class: 'empty-state' }, t('aucunePublication'))
    ));
    return;
  }

  // Connecté : fil entièrement interactif (like, commentaire, envoyer/partager, modifier/supprimer si auteur).
  if (loggedUser) {
    for (const p of posts) feed.append(postCard(p));
    return;
  }

  for (const p of posts) {
    feed.append(
      h('article', { class: 'panel public-post-card' },
        h('div', { class: 'post-head' },
          h('div', null,
            h('strong', null, `${p.author.firstName} ${p.author.lastName}`),
            h('div', { class: 'muted' }, `${p.author.role} · ${fmtDateTime(p.createdAt)}`)
          ),
          h('span', { class: 'badge' }, p.type === 'ARTICLE' ? t('article') : t('publication'))
        ),
        h('h2', null, p.title),
        p.imageUrl ? h('img', { class: 'post-image', src: mediaUrl(p.imageUrl), alt: '' }) : null,
        h('p', { class: 'post-content' }, p.content),
        h('div', { class: 'public-post-actions' },
          h('span', null, `♥ ${p.likes}`),
          h('span', null, `💬 ${p.comments}`),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { location.hash = '#/login'; } }, t('seConnecterPourInteragir'))
        )
      )
    );
  }
}

function renderLogin() {
  document.title = 'Connexion — Cabinet Élite Juridique';
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' });
  const password = h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' });
  const errorBox = h('p', { class: 'form-error', hidden: true });
  const submitBtn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Se connecter');
  const registerBtn = h('button', { class: 'btn btn-link btn-block', type: 'button', onclick: () => openRegistrationModal() }, 'Demander un accès');

  const form = h(
    'form',
    {
      class: 'login-form',
      onsubmit: async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Connexion…';
        try {
          const body = await api.login(email.value.trim(), password.value);
          setSession({ accessToken: body.accessToken, refreshToken: body.refreshToken, user: body.user });
          // Direction explicite vers le tableau de bord : rester sur #/home donnait
          // l'impression que la connexion n'avait rien fait, car c'est la même page
          // publique (juste avec un bouton « Mon espace » en plus, facile à manquer).
          location.hash = '#/dashboard';
          if (location.hash === '#/dashboard') await route();
        } catch (err) {
          errorBox.textContent = errorMessage(err);
          errorBox.hidden = false;
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Se connecter';
        }
      },
    },
    field('Adresse courriel', email),
    field('Mot de passe', password),
    errorBox,
    submitBtn,
    registerBtn,
  );

  clear(root).append(
    h(
      'div',
      { class: 'auth-screen' },
      h(
        'div',
        { class: 'auth-card' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '⚖'), h('span', { class: 'brand-name' }, 'Cabinet Élite Juridique')),
        h('p', { class: 'auth-tagline' }, 'Plateforme interne — accès réservé au personnel et aux clients du cabinet.'),
        form,
      ),
    ),
  );
  email.focus();
}

/* ------------------------------------------------------------------ */
/* Coquille applicative : barre latérale + barre supérieure            */
/* ------------------------------------------------------------------ */

const NAV = [
  { key: 'home', label: 'Accueil', icon: 'dashboard', perm: 'posts.read' },
  { key: 'ai', label: 'Assistant AI', icon: 'search', perm: 'ai.ask' },
  { key: 'messages', label: 'Messages', icon: 'messages', perm: 'messages.read' },
  { key: 'dashboard', label: 'Tableau de bord', icon: 'dashboard', perm: 'dashboard.read' },
  { key: 'clients', label: 'Clients', icon: 'clients', perm: 'clients.read' },
  { key: 'cases', label: 'Dossiers', icon: 'cases', perm: 'cases.read', clientLabel: 'Mes dossiers' },
  { key: 'invoices', label: 'Facturation', icon: 'billing', perm: 'billing.read', clientLabel: 'Mes factures' },
  { key: 'users', label: 'Utilisateurs', icon: 'users', perm: 'users.read' },
  { key: 'audit', label: "Journal d'audit", icon: 'audit', perm: 'audit.read' },
];

function highlightNav(name) {
  for (const a of document.querySelectorAll('.nav a')) {
    a.classList.toggle('is-active', a.dataset.key === name);
    if (a.dataset.key === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

let shellBuilt = false;

function renderShell(perms) {
  document.title = 'Cabinet Élite Juridique';
  if (shellBuilt) {
    $('#user-name').textContent = `${currentUser.firstName} ${currentUser.lastName}`;
    $('#user-role').textContent = ROLE_LABEL[currentUser.role] ?? currentUser.role;
    refreshUnreadBadge();
    return;
  }
  shellBuilt = true;

  const navList = h(
    'nav',
    { class: 'nav' },
    NAV.filter((n) => perms.has(n.perm)).map((n) =>
      h(
        'a',
        { href: `#/${n.key}`, 'data-key': n.key, onclick: () => setTimeout(() => highlightNav(n.key), 0) },
        icon(n.icon),
        h('span', null, currentUser.role === 'CLIENT' && n.clientLabel ? n.clientLabel : n.label),
      ),
    ),
  );

  const searchInput = h('input', { type: 'search', placeholder: 'Rechercher un client, un dossier, un document…' });
  const searchResults = h('div', { class: 'search-results', hidden: true });
  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (!q) return void (searchResults.hidden = true);
    searchDebounce = setTimeout(async () => {
      const res = await guarded(() => api.search(q));
      if (!res) return;
      renderSearchResults(searchResults, res);
    }, 250);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) searchResults.hidden = true;
  });

  const notifBell = h('button', { class: 'icon-btn notif-btn', type: 'button', 'aria-label': 'Notifications', onclick: toggleNotifPanel }, icon('bell'), h('span', { class: 'notif-badge', id: 'notif-badge', hidden: true }));
  const notifPanel = h('div', { class: 'notif-panel', id: 'notif-panel', hidden: true });

  const themeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Changer de thème', onclick: toggleTheme }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));

  clear(root).append(
    h(
      'div',
      { class: 'shell' },
      h(
        'aside',
        { class: 'sidebar' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '⚖'), h('span', { class: 'brand-name' }, 'Cabinet Élite')),
        navList,
        h(
          'div',
          { class: 'sidebar-user' },
          h('div', { class: 'avatar' }, initials(currentUser.firstName, currentUser.lastName)),
          h('div', { class: 'sidebar-user-info' }, h('strong', { id: 'user-name' }, `${currentUser.firstName} ${currentUser.lastName}`), h('span', { id: 'user-role' }, ROLE_LABEL[currentUser.role] ?? currentUser.role)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Se déconnecter', onclick: logout }, icon('logout')),
        ),
      ),
      h(
        'div',
        { class: 'content-col' },
        h(
          'header',
          { class: 'topbar' },
          h('div', { class: 'search-box' }, icon('search'), searchInput, searchResults),
          h('div', { class: 'topbar-actions' }, themeBtn, h('div', { class: 'notif-wrap' }, notifBell, notifPanel)),
        ),
        h('main', { id: 'main', tabindex: '-1' }),
      ),
    ),
  );

  refreshUnreadBadge();
}

function renderSearchResults(container, res) {
  clear(container).hidden = false;
  const groups = [
    ['clients', 'Clients', (r) => `#/clients/${r.id}`],
    ['cases', 'Dossiers', (r) => `#/cases/${r.id}`],
    ['documents', 'Documents', (r) => `#/cases/${r.caseId}`],
  ];
  let any = false;
  for (const [key, label, hrefFn] of groups) {
    const items = res[key] ?? [];
    if (!items.length) continue;
    any = true;
    container.append(
      h('div', { class: 'search-group-label' }, label),
      ...items.map((it) => h('a', { class: 'search-item', href: hrefFn(it), onclick: () => (container.hidden = true) }, h('strong', null, it.label), h('span', null, it.meta ?? ''))),
    );
  }
  if (!any) container.append(h('p', { class: 'search-empty' }, 'Aucun résultat.'));
}

function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  try {
    localStorage.setItem('cej:theme', next);
  } catch {}
  if (currentUser) {
    shellBuilt = false;
    renderShell(new Set(currentUser.permissions));
  }
  route();
}

async function refreshUnreadBadge() {
  const res = await guarded(() => api.unreadCount(), { onError: () => {} });
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (res?.count) {
    badge.textContent = res.count > 9 ? '9+' : String(res.count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

async function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  clear(panel).append(h('p', { class: 'loading' }, 'Chargement…'));
  const items = await guarded(() => api.notifications());
  clear(panel);
  if (!items?.length) {
    panel.append(h('p', { class: 'notif-empty' }, 'Aucune notification.'));
    return;
  }
  panel.append(
    h(
      'div',
      { class: 'notif-header' },
      h('span', null, 'Notifications'),
      h('button', { class: 'link-btn', type: 'button', onclick: async () => { await guarded(() => api.markAllRead()); toggleNotifPanel(); toggleNotifPanel(); refreshUnreadBadge(); } }, 'Tout marquer comme lu'),
    ),
    ...items.map((n) =>
      h(
        'a',
        {
          class: `notif-item${n.isRead ? '' : ' unread'}`,
          href: n.caseId ? `#/cases/${n.caseId}` : '#/dashboard',
          onclick: async () => { if (!n.isRead) { await guarded(() => api.markNotificationRead(n.id)); refreshUnreadBadge(); } panel.hidden = true; },
        },
        h('span', { class: 'notif-title' }, n.title),
        h('span', { class: 'notif-date' }, fmtDateTime(n.createdAt)),
      ),
    ),
  );
}

function logout() {
  setSession(null);
  shellBuilt = false;
  location.hash = '';
  renderPublicHome();
}

/* ------------------------------------------------------------------ */
/* Accueil social / AI / Messagerie                                    */

function openRegistrationModal() {
  const f={firstName:h('input',{required:true}),lastName:h('input',{required:true}),email:h('input',{type:'email',required:true}),message:h('textarea',{rows:4,placeholder:'Pourquoi souhaitez-vous accéder à la plateforme ?'})};
  const form=h('form',{class:'stacked-form',onsubmit:async e=>{e.preventDefault();try{await api.registerRequest({firstName:f.firstName.value.trim(),lastName:f.lastName.value.trim(),email:f.email.value.trim(),message:f.message.value.trim()});close();alert('Votre demande a été envoyée. Un administrateur doit l’approuver.');}catch(err){toast(errorMessage(err),'error');}}},field('Prénom',f.firstName),field('Nom',f.lastName),field('Courriel',f.email),field('Message',f.message),h('button',{class:'btn btn-primary',type:'submit'},'Envoyer la demande'));
  const close=openModal('Demander un accès',form);
}

async function viewHome(main){
  const perms=new Set(currentUser.permissions);
  const feed=h('div',{class:'feed'},h('section',{class:'panel'},h('p',{class:'loading'},'Chargement des publications…')));
  const composer=perms.has('posts.create')
    ? h('button',{class:'btn btn-primary',type:'button',onclick:()=>openPostModal()},icon('plus'),'Publier')
    : null;
  clear(main).append(
    h('div',{class:'page social-page'},
      h('div',{class:'page-head'},
        h('div',null,h('h1',{tabindex:'-1'},'Accueil'),h('p',{class:'muted'},'Actualités, articles et échanges du cabinet.')),
        composer
      ),
      feed
    )
  );

  try {
    const posts=await api.posts();
    clear(feed);
    if(!posts?.length){
      feed.append(h('section',{class:'panel'},
        h('h2',null,'Publications du cabinet'),
        h('p',{class:'empty-state'},perms.has('posts.create')
          ? 'Aucune publication pour le moment. Utilisez « Publier » pour créer la première.'
          : 'Aucune publication pour le moment.')
      ));
      return;
    }
    feed.append(...posts.map(postCard));
  } catch(err) {
    clear(feed).append(
      h('section',{class:'panel'},
        h('h2',null,'Accueil'),
        h('p',{class:'form-error'},errorMessage(err)),
        h('button',{class:'btn',type:'button',onclick:()=>viewHome(main)},'Réessayer')
      )
    );
  }
}
function openPostModal(existing=null, refresh=viewHome){
  const f={title:h('input',{required:true,value:existing?.title||'',placeholder:'Titre'}),content:h('textarea',{required:true,rows:9,placeholder:'Écrivez votre publication ou article…'},existing?.content||''),type:h('select',null,h('option',{value:'POST',selected:(existing?.type||'POST')==='POST'},'Publication'),h('option',{value:'ARTICLE',selected:existing?.type==='ARTICLE'},'Article'))};
  let selectedImage=null, removeImage=false;
  const preview=h('div',{class:'post-image-preview',hidden:!existing?.imageUrl},existing?.imageUrl?h('img',{src:mediaUrl(existing.imageUrl),alt:''}):null);
  const imageInput=h('input',{type:'file',accept:'image/png,image/jpeg,image/gif,image/webp',onchange:()=>{
    const file=imageInput.files[0];
    if(!file)return;
    selectedImage=file; removeImage=false;
    clear(preview).append(h('img',{src:URL.createObjectURL(file),alt:''}));
    preview.hidden=false;
  }});
  const removeBtn=h('button',{class:'link-btn',type:'button',hidden:!existing?.imageUrl,onclick:()=>{
    selectedImage=null; removeImage=true; imageInput.value='';
    clear(preview); preview.hidden=true; removeBtn.hidden=true;
  }},'Retirer l’image');
  const form=h('form',{class:'stacked-form',onsubmit:async e=>{e.preventDefault();try{if(existing)await api.updatePost(existing.id,{title:f.title.value.trim(),content:f.content.value.trim(),type:f.type.value},selectedImage,removeImage);else await api.createPost({title:f.title.value.trim(),content:f.content.value.trim(),type:f.type.value},selectedImage);close();toast(existing?'Publication modifiée.':'Publication publiée.');refresh($('#main'));}catch(err){toast(errorMessage(err),'error');}}},field('Titre',f.title),field('Type',f.type),field('Contenu',f.content),field('Image (optionnel)',imageInput),preview,removeBtn,h('button',{class:'btn btn-primary',type:'submit'},existing?'Enregistrer':'Publier'));
  const close=openModal(existing?'Modifier la publication':'Nouvelle publication',form,{wide:true});
}
function postCard(p){
  const comments=h('div',{class:'post-comments'}); const commentInput=h('input',{placeholder:'Écrire un commentaire…'});
  const loadComments=async()=>{const rows=await guarded(()=>api.postComments(p.id));clear(comments);for(const c of rows||[])comments.append(h('div',{class:'comment'},h('strong',null,`${c.user.firstName} ${c.user.lastName}`),h('span',null,c.content)));};
  const likeBtn=h('button',{class:'post-action',onclick:async()=>{const r=await api.toggleLike(p.id);p.likedByMe=r.liked;p.likes=r.likes;likeBtn.textContent=`♥ ${r.likes}`;}} ,`♥ ${p.likes}`);
  const commentBtn=h('button',{class:'post-action',onclick:async()=>{comments.hidden=!comments.hidden;if(!comments.hidden)await loadComments();}},`💬 ${p.comments}`);
  const sendBtn=h('button',{class:'post-action',onclick:()=>openSendMessage(p)},'↗ Envoyer');
  const ownerActions=p.canEdit?h('div',{class:'post-owner-actions'},h('button',{class:'btn btn-small',onclick:()=>openPostModal(p,viewHome)},'Modifier'),p.canDelete&&h('button',{class:'btn btn-small danger',onclick:async()=>{if(confirm('Supprimer cette publication ?')){await api.deletePost(p.id);viewHome($('#main'));}}},'Supprimer')):null;
  const commentForm=h('form',{class:'comment-form',onsubmit:async e=>{e.preventDefault();if(!commentInput.value.trim())return;await api.addComment(p.id,commentInput.value.trim());commentInput.value='';p.comments++;commentBtn.textContent=`💬 ${p.comments}`;await loadComments();}},commentInput,h('button',{class:'btn btn-small',type:'submit'},'Commenter'));
  const image=p.imageUrl?h('img',{class:'post-image',src:mediaUrl(p.imageUrl),alt:''}):null;
  return h('article',{class:'panel post-card'},h('div',{class:'post-head'},h('div',null,h('strong',null,`${p.author.firstName} ${p.author.lastName}`),h('div',{class:'muted'},`${p.author.role} · ${fmtDateTime(p.createdAt)}`)),ownerActions),h('span',{class:'badge'},p.type==='ARTICLE'?'Article':'Publication'),h('h2',null,p.title),image,h('p',{class:'post-content'},p.content),h('div',{class:'post-actions'},likeBtn,commentBtn,sendBtn),comments,commentForm);
}
async function openSendMessage(post){const users=await api.messageUsers();const sel=h('select',null,...users.map(u=>h('option',{value:u.id},`${u.first_name} ${u.last_name} — ${u.role}`)));const msg=h('textarea',{rows:4},`Bonjour, pouvez-vous m’expliquer davantage votre publication « ${post.title} » ?`);const form=h('form',{class:'stacked-form',onsubmit:async e=>{e.preventDefault();await api.sendMessage(Number(sel.value),msg.value.trim());close();toast('Message envoyé.');}},field('Destinataire',sel),field('Message',msg),h('button',{class:'btn btn-primary',type:'submit'},'Envoyer')) ;const close=openModal('Demander plus d’explications',form);}

async function viewMessages(main) {
  const users = await api.messageUsers();
  let selected = users[0];
  const list = h('div', { class: 'message-users' });
  const body = h('div', { class: 'message-body' });
  const input = h('input', { placeholder: 'Écrire un message…' });
  const load = async () => {
    if (!selected) return;
    clear(body);
    const rows = await api.messages(selected.id);
    for (const m of rows) {
      body.append(h('div', { class: `message ${m.mine ? 'mine' : ''}` }, m.content, h('small', { class: 'muted' }, fmtDateTime(m.createdAt))));
    }
    body.scrollTop = body.scrollHeight;
  };
  for (const u of users) {
    list.append(h('button', { class: 'message-user', onclick: () => { selected = u; load(); } }, `${u.first_name} ${u.last_name}`));
  }
  const form = h('form', { class: 'message-compose', onsubmit: async (e) => {
    e.preventDefault();
    if (!selected || !input.value.trim()) return;
    await api.sendMessage(selected.id, input.value.trim());
    input.value = '';
    await load();
  } }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Envoyer'));
  clear(main).append(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', null, 'Messages directs')),
      h('div', { class: 'messenger' }, list, h('section', { class: 'message-window' }, body, form)),
    ),
  );
  await load();
}

async function viewAI(main){
  const caseSelect=h('select',null,h('option',{value:''},'Tous les documents accessibles'));
  const question=h('textarea',{rows:5,placeholder:'Ex. Résume-moi ce dossier et indique les documents importants.'});
  const answer=h('div',{class:'ai-answer'});
  const statusBox=h('div',{class:'panel ai-status'},h('p',{class:'loading'},'Vérification de l’assistant…'));
  const cases=await guarded(()=>api.cases({}));
  for(const c of cases||[])caseSelect.append(h('option',{value:c.id},`${c.caseNumber} — ${c.title}`));

  try {
    const status=await api.aiStatus();
    clear(statusBox).append(
      h('h3',null,'Assistant documentaire'),
      h('p',null,status.configured
        ? `Ollama est prêt. Modèle de réponse : ${status.chatModel}. Recherche documentaire : ${status.embeddingModel}.`
        : `Ollama est accessible, mais un modèle manque. Utilisez les modèles indiqués dans le README : ${status.chatModel} et ${status.embeddingModel}.`)
    );
  } catch(err) {
    clear(statusBox).append(h('h3',null,'Assistant documentaire'),h('p',{class:'form-error'},errorMessage(err)));
  }

  const form=h('form',{class:'stacked-form',onsubmit:async e=>{
    e.preventDefault();
    if(!question.value.trim()) return;
    clear(answer).append(h('p',{class:'loading'},'Recherche dans les documents…'));
    try{
      const r=await api.askAI(question.value,caseSelect.value?Number(caseSelect.value):undefined);
      clear(answer).append(h('p',null,r.answer));
      if((r.sources||[]).length){
        answer.append(h('h3',null,'Documents utilisés'),...(r.sources||[]).map(s=>h('div',{class:'source-item'},`[Source ${s.number}] ${s.name} — ${s.caseNumber}`)));
      }
    }catch(err){clear(answer).append(h('p',{class:'form-error'},errorMessage(err)));}
  }},field('Dossier',caseSelect),field('Question',question),h('button',{class:'btn btn-primary',type:'submit'},'Poser la question'));
  clear(main).append(h('div',{class:'page'},h('div',{class:'page-head'},h('h1',null,'Assistant AI'),h('p',{class:'muted'},'L’assistant recherche uniquement dans les documents auxquels vous avez accès.')),statusBox,h('section',{class:'panel'},form),h('section',{class:'panel'},h('h2',null,'Réponse'),answer)));
}

/* ------------------------------------------------------------------ */
/* Tableau de bord                                                     */
/* ------------------------------------------------------------------ */

async function viewDashboard(main) {
  const data = await guarded(() => api.dashboard());
  if (!data) return;

  const kpi = (label, value, iconName) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-icon' }, icon(iconName)), h('div', { class: 'kpi-text' }, h('div', { class: 'kpi-value' }, value), h('div', { class: 'kpi-label' }, label)));

  const statusBars = h(
    'div',
    { class: 'status-chart' },
    Object.entries(CASE_STATUS).map(([key, label]) => {
      const n = data.cases.byStatus[key] ?? 0;
      const max = Math.max(1, ...Object.values(data.cases.byStatus));
      return h(
        'div',
        { class: 'status-bar-row' },
        h('span', { class: 'status-bar-label' }, label),
        h('div', { class: 'status-bar-track' }, h('div', { class: 'status-bar-fill', style: `width:${(n / max) * 100}%` })),
        h('span', { class: 'status-bar-value' }, String(n)),
      );
    }),
  );

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, 'Tableau de bord'), h('p', { class: 'muted' }, `Bienvenue, ${currentUser.firstName}.`)),
      h(
        'div',
        { class: 'kpi-grid' },
        kpi('Dossiers actifs', data.cases.active, 'cases'),
        kpi('Clients', data.clients.total, 'clients'),
        kpi(`${data.billing.unpaidCount} facture(s) impayée(s)`, fmtMoneyShort(data.billing.unpaidCents), 'billing'),
        kpi('Documents', data.documents.total, 'documents'),
      ),
      h(
        'div',
        { class: 'grid-2' },
        h('section', { class: 'panel' }, h('h2', null, 'Dossiers par statut'), statusBars),
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Activité récente'),
          data.recentCases.length
            ? h('ul', { class: 'activity-list' }, data.recentCases.map((c) => h('li', null, h('a', { href: `#/cases/${c.id}` }, c.title), h('span', { class: 'muted' }, `${c.clientName} · ${fmtDate(c.updatedAt)}`), statusDot(c.status, CASE_STATUS))))
            : h('p', { class: 'empty-state' }, 'Aucune activité récente.'),
        ),
      ),
    ),
  );
  main.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

function clientForm(existing, onSubmit) {
  const f = {
    firstName: h('input', { required: true, value: existing?.firstName ?? '' }),
    lastName: h('input', { required: true, value: existing?.lastName ?? '' }),
    email: h('input', { type: 'email', value: existing?.email ?? '' }),
    phone: h('input', { value: existing?.phone ?? '' }),
    company: h('input', { value: existing?.company ?? '' }),
    address: h('input', { value: existing?.address ?? '' }),
    notes: h('textarea', { rows: 3 }, existing?.notes ?? ''),
  };
  const errorBox = h('p', { class: 'form-error', hidden: true });
  const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Enregistrer' : 'Créer le client');
  const form = h(
    'form',
    {
      class: 'stacked-form',
      onsubmit: async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        try {
          await onSubmit({
            firstName: f.firstName.value.trim(),
            lastName: f.lastName.value.trim(),
            email: f.email.value.trim(),
            phone: f.phone.value.trim(),
            company: f.company.value.trim(),
            address: f.address.value.trim(),
            notes: f.notes.value.trim(),
          });
        } catch (err) {
          errorBox.textContent = errorMessage(err);
          errorBox.hidden = false;
        }
      },
    },
    h('div', { class: 'form-row' }, field('Prénom', f.firstName), field('Nom', f.lastName)),
    h('div', { class: 'form-row' }, field('Courriel', f.email), field('Téléphone', f.phone)),
    field('Entreprise', f.company),
    field('Adresse', f.address),
    field('Notes', f.notes),
    errorBox,
    submitBtn,
  );
  return form;
}

async function viewClients(main) {
  const perms = new Set(currentUser.permissions);
  const searchInput = h('input', { type: 'search', placeholder: 'Rechercher…', class: 'inline-search' });
  const tableBody = h('tbody');

  async function load(q = '') {
    const rows = await guarded(() => api.clients(q));
    clear(tableBody);
    if (!rows?.length) {
      tableBody.append(h('tr', null, h('td', { colspan: 5, class: 'empty-state' }, 'Aucun client.')));
      return;
    }
    for (const c of rows) {
      tableBody.append(
        h(
          'tr',
          { class: 'row-link', tabindex: '0', onclick: () => (location.hash = `#/clients/${c.id}`) },
          h('td', null, h('strong', null, `${c.firstName} ${c.lastName}`)),
          h('td', null, c.company || '—'),
          h('td', null, c.email || '—'),
          h('td', null, c.phone || '—'),
          h('td', { class: 'muted' }, fmtDate(c.createdAt)),
        ),
      );
    }
  }

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => load(searchInput.value.trim()), 220);
  });

  const newBtn = perms.has('clients.create')
    ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
        const form = clientForm(null, async (body) => {
          const created = await api.createClient(body);
          close();
          toast('Client créé.');
          location.hash = `#/clients/${created.id}`;
        });
        const close = openModal('Nouveau client', form);
      } }, icon('plus'), 'Nouveau client')
    : null;

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, 'Clients'), h('div', { class: 'page-actions' }, searchInput, newBtn)),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Nom'), h('th', null, 'Entreprise'), h('th', null, 'Courriel'), h('th', null, 'Téléphone'), h('th', null, 'Créé le'))),
          tableBody,
        ),
      ),
    ),
  );
  await load();
  main.focus({ preventScroll: true });
}

async function viewClientDetail(main, id) {
  const perms = new Set(currentUser.permissions);
  const [client, cases, invoices] = await Promise.all([
    guarded(() => api.client(id)),
    guarded(() => api.cases({ q: '' })),
    perms.has('billing.read') ? guarded(() => api.invoices()) : Promise.resolve([]),
  ]);
  if (!client) return;

  const clientCases = (cases ?? []).filter((c) => c.clientId === Number(id));
  const clientInvoices = (invoices ?? []).filter((i) => i.clientId === Number(id));

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('a', { class: 'back-link', href: '#/clients' }, icon('chevronLeft'), 'Clients'),
      h(
        'div',
        { class: 'page-head' },
        h('h1', { tabindex: '-1' }, `${client.firstName} ${client.lastName}`),
        perms.has('clients.update') &&
          h('button', { class: 'btn', type: 'button', onclick: () => {
            const form = clientForm(client, async (body) => { await api.updateClient(id, body); close(); toast('Client mis à jour.'); viewClientDetail(main, id); });
            const close = openModal('Modifier le client', form);
          } }, 'Modifier'),
      ),
      h(
        'div',
        { class: 'grid-2' },
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Coordonnées'),
          h('dl', { class: 'definition-list' },
            h('dt', null, 'Entreprise'), h('dd', null, client.company || '—'),
            h('dt', null, 'Courriel'), h('dd', null, client.email || '—'),
            h('dt', null, 'Téléphone'), h('dd', null, client.phone || '—'),
            h('dt', null, 'Adresse'), h('dd', null, client.address || '—'),
          ),
          client.notes && h('p', { class: 'notes-box' }, client.notes),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Dossiers'),
          clientCases.length
            ? h('ul', { class: 'activity-list' }, clientCases.map((c) => h('li', null, h('a', { href: `#/cases/${c.id}` }, c.title), statusDot(c.status, CASE_STATUS))))
            : h('p', { class: 'empty-state' }, 'Aucun dossier.'),
        ),
      ),
      perms.has('billing.read') &&
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Factures'),
          clientInvoices.length
            ? h('ul', { class: 'activity-list' }, clientInvoices.map((i) => h('li', null, h('span', null, i.invoiceNumber), h('span', { class: 'muted' }, fmtMoney(i.totalCents)), statusDot(i.status, INVOICE_STATUS))))
            : h('p', { class: 'empty-state' }, 'Aucune facture.'),
        ),
    ),
  );
  main.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Dossiers                                                             */
/* ------------------------------------------------------------------ */

async function caseForm(existing, onSubmit) {
  const perms = new Set(currentUser.permissions);
  const [clients, lawyers] = await Promise.all([
    guarded(() => api.clients()),
    perms.has('users.read') ? guarded(() => api.users()) : Promise.resolve([]),
  ]);
  const lawyerOptions = (lawyers ?? []).filter((u) => u.role === 'LAWYER' && u.isActive);

  const f = {
    title: h('input', { required: true, value: existing?.title ?? '' }),
    clientId: h(
      'select', { required: true, disabled: !!existing },
      h('option', { value: '' }, 'Sélectionner…'),
      ...(clients ?? []).map((c) => h('option', { value: c.id, selected: existing?.clientId === c.id }, `${c.firstName} ${c.lastName}`)),
    ),
    lawyerId: h(
      'select', null,
      h('option', { value: '' }, 'Non assigné'),
      ...lawyerOptions.map((u) => h('option', { value: u.id, selected: existing?.lawyerId === u.id }, `${u.firstName} ${u.lastName}`)),
    ),
    caseType: h('input', { value: existing?.caseType ?? '' }),
    priority: h(
      'select', null,
      ...Object.entries(CASE_PRIORITY).map(([v, l]) => h('option', { value: v, selected: (existing?.priority ?? 'NORMALE') === v }, l)),
    ),
    dueDate: h('input', { type: 'date', value: existing?.dueDate ? existing.dueDate.slice(0, 10) : '' }),
    description: h('textarea', { rows: 3 }, existing?.description ?? ''),
  };
  const errorBox = h('p', { class: 'form-error', hidden: true });
  const form = h(
    'form',
    {
      class: 'stacked-form',
      onsubmit: async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        try {
          await onSubmit({
            title: f.title.value.trim(),
            clientId: Number(f.clientId.value),
            lawyerId: f.lawyerId.value ? Number(f.lawyerId.value) : null,
            caseType: f.caseType.value.trim(),
            priority: f.priority.value,
            dueDate: f.dueDate.value || null,
            description: f.description.value.trim(),
          });
        } catch (err) {
          errorBox.textContent = errorMessage(err);
          errorBox.hidden = false;
        }
      },
    },
    field('Titre du dossier', f.title),
    h('div', { class: 'form-row' }, field('Client', f.clientId), field('Avocat responsable', f.lawyerId)),
    h('div', { class: 'form-row' }, field('Type de dossier', f.caseType), field('Priorité', f.priority)),
    field("Date d'échéance", f.dueDate),
    field('Description', f.description),
    errorBox,
    h('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Enregistrer' : 'Créer le dossier'),
  );
  return form;
}

async function viewCases(main) {
  const perms = new Set(currentUser.permissions);
  let statusFilter = '';
  const tableBody = h('tbody');

  async function load() {
    const rows = await guarded(() => api.cases(statusFilter ? { status: statusFilter } : {}));
    clear(tableBody);
    if (!rows?.length) {
      tableBody.append(h('tr', null, h('td', { colspan: 6, class: 'empty-state' }, 'Aucun dossier.')));
      return;
    }
    for (const c of rows) {
      tableBody.append(
        h(
          'tr',
          { class: 'row-link', tabindex: '0', onclick: () => (location.hash = `#/cases/${c.id}`) },
          h('td', null, h('span', { class: 'mono' }, c.caseNumber)),
          h('td', null, h('strong', null, c.title)),
          h('td', null, c.clientName ?? '—'),
          h('td', null, c.lawyerName ?? '—'),
          h('td', null, statusDot(c.status, CASE_STATUS)),
          h('td', null, CASE_PRIORITY[c.priority] ?? c.priority),
        ),
      );
    }
  }

  const chips = h(
    'div',
    { class: 'chips' },
    h('button', { class: 'chip is-active', type: 'button', onclick: (e) => selectChip(e, '') }, 'Tous'),
    ...Object.entries(CASE_STATUS).map(([v, l]) => h('button', { class: 'chip', type: 'button', onclick: (e) => selectChip(e, v) }, l)),
  );
  function selectChip(e, value) {
    statusFilter = value;
    for (const c of chips.children) c.classList.toggle('is-active', c === e.currentTarget);
    load();
  }

  const newBtn = perms.has('cases.create')
    ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const form = await caseForm(null, async (body) => {
          const created = await api.createCase(body);
          close();
          toast('Dossier créé.');
          location.hash = `#/cases/${created.id}`;
        });
        const close = openModal('Nouveau dossier', form, { wide: true });
      } }, icon('plus'), 'Nouveau dossier')
    : null;

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, 'Dossiers'), newBtn),
      chips,
      h(
        'div',
        { class: 'table-wrap' },
        h('table', null, h('thead', null, h('tr', null, h('th', null, 'Numéro'), h('th', null, 'Titre'), h('th', null, 'Client'), h('th', null, 'Avocat'), h('th', null, 'Statut'), h('th', null, 'Priorité'))), tableBody),
      ),
    ),
  );
  await load();
  main.focus({ preventScroll: true });
}

async function viewCaseDetail(main, id) {
  const perms = new Set(currentUser.permissions);
  const c = await guarded(() => api.case(id));
  if (!c) return;

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'tab-panel' });
  const tabDefs = [
    ['overview', 'Aperçu', () => renderOverview()],
    perms.has('documents.read') && ['documents', 'Documents', () => renderDocuments()],
    ['notes', 'Notes', () => renderNotes()],
  ].filter(Boolean);

  function setTab(key) {
    for (const btn of tabs.children) btn.setAttribute('aria-selected', String(btn.dataset.key === key));
    clear(panel);
    tabDefs.find((t) => t[0] === key)[2]();
  }
  tabs.append(...tabDefs.map(([key, label]) => h('button', { type: 'button', role: 'tab', 'data-key': key, onclick: () => setTab(key) }, label)));

  function renderOverview() {
    panel.append(
      h(
        'div',
        { class: 'grid-2' },
        h('dl', { class: 'definition-list' },
          h('dt', null, 'Client'), h('dd', null, h('a', { href: `#/clients/${c.clientId}` }, c.clientName)),
          h('dt', null, 'Avocat responsable'), h('dd', null, c.lawyerName ?? 'Non assigné'),
          h('dt', null, 'Type'), h('dd', null, c.caseType || '—'),
          h('dt', null, 'Priorité'), h('dd', null, CASE_PRIORITY[c.priority] ?? c.priority),
          h('dt', null, "Date d'échéance"), h('dd', null, fmtDate(c.dueDate)),
          h('dt', null, 'Créé le'), h('dd', null, fmtDate(c.createdAt)),
        ),
        h('div', null, h('h3', null, 'Description'), h('p', { class: 'notes-box' }, c.description || 'Aucune description.')),
      ),
    );
  }

  async function renderDocuments() {
    panel.append(h('p', { class: 'loading' }, 'Chargement…'));
    const docs = await guarded(() => api.documents(id));
    clear(panel);

    const list = h('div', { class: 'doc-list' });
    function renderList(items) {
      clear(list);
      if (!items.length) return list.append(h('p', { class: 'empty-state' }, 'Aucun document.'));
      for (const d of items) {
        list.append(
          h(
            'div',
            { class: 'doc-row' },
            icon('file'),
            h('div', { class: 'doc-info' }, h('strong', null, d.originalName), h('span', { class: 'muted' }, `v${d.version} · ${(d.sizeBytes / 1024).toFixed(0)} Ko · ${d.uploadedBy} · ${fmtDate(d.createdAt)}`)),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Télécharger', onclick: () => guarded(() => downloadFile(`/documents/${d.id}/download`, d.originalName)) }, icon('download')),
            h('span', { class: `badge ${d.indexedAt ? 'badge-success' : ''}` }, d.indexedAt ? 'Analysé pour l’assistant' : 'Analyse en attente'),
            perms.has('ai.manage') && !d.indexedAt && h('button', { class: 'btn btn-small', type: 'button', onclick: async () => { try { await api.indexDocument(d.id); toast(`« ${d.originalName} » est maintenant disponible pour l’assistant.`); renderDocuments(); } catch (err) { toast(errorMessage(err), 'error'); } } }, 'Analyser maintenant'),
            perms.has('documents.delete') &&
              h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Supprimer', onclick: async () => {
                if (!confirm(`Supprimer « ${d.originalName} » ?`)) return;
                await guarded(() => api.deleteDocument(d.id));
                renderList(items.filter((x) => x.id !== d.id));
                toast('Document supprimé.');
              } }, icon('trash')),
          ),
        );
      }
    }
    renderList(docs ?? []);

    if (perms.has('documents.upload')) {
      const fileInput = h('input', { type: 'file', id: 'doc-upload', class: 'sr-only' });
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        try {
          const uploaded = await api.uploadDocument(id, file);
          const fresh = await api.documents(id);
          renderList(fresh);
          toast(uploaded?.indexing?.status === 'ready' ? `« ${uploaded.originalName} » est ajouté et prêt pour l’assistant.` : `« ${uploaded.originalName} » est ajouté. L’analyse sera relancée depuis le bouton « Analyser maintenant ».`, uploaded?.indexing?.status === 'ready' ? 'success' : 'info');
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
        fileInput.value = '';
      });
      panel.append(h('label', { class: 'btn btn-primary upload-btn', for: 'doc-upload' }, icon('plus'), 'Téléverser un document'), fileInput, list);
    } else {
      panel.append(list);
    }
  }

  async function renderNotes() {
    panel.append(h('p', { class: 'loading' }, 'Chargement…'));
    const notes = await guarded(() => api.caseNotes(id));
    clear(panel);
    const list = h('div', { class: 'note-list' });
    function renderList(items) {
      clear(list);
      if (!items.length) return list.append(h('p', { class: 'empty-state' }, 'Aucune note.'));
      for (const n of items) list.append(h('div', { class: 'note-card' }, h('p', null, n.content), h('span', { class: 'muted' }, `${n.authorName} · ${fmtDateTime(n.createdAt)}`)));
    }
    renderList(notes ?? []);

    if (perms.has('cases.update')) {
      const textarea = h('textarea', { rows: 2, placeholder: 'Ajouter une note…' });
      const addForm = h(
        'form',
        { class: 'note-form', onsubmit: async (e) => {
          e.preventDefault();
          const content = textarea.value.trim();
          if (!content) return;
          const created = await guarded(() => api.addCaseNote(id, content));
          if (!created) return;
          textarea.value = '';
          const fresh = await api.caseNotes(id);
          renderList(fresh);
        } },
        textarea,
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Ajouter'),
      );
      panel.append(addForm, list);
    } else {
      panel.append(list);
    }
  }

  const statusSelect = perms.has('cases.update')
    ? h(
        'select', { class: 'status-select', onchange: async (e) => {
          await guarded(() => api.updateCase(id, { status: e.target.value }));
          toast('Statut mis à jour.');
        } },
        ...Object.entries(CASE_STATUS).map(([v, l]) => h('option', { value: v, selected: c.status === v }, l)),
      )
    : statusDot(c.status, CASE_STATUS);

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('a', { class: 'back-link', href: '#/cases' }, icon('chevronLeft'), 'Dossiers'),
      h(
        'div',
        { class: 'page-head' },
        h('div', null, h('span', { class: 'mono muted' }, c.caseNumber), h('h1', { tabindex: '-1' }, c.title)),
        h('div', { class: 'page-actions' }, statusSelect, perms.has('cases.update') && h('button', { class: 'btn', type: 'button', onclick: async () => {
          const form = await caseForm(c, async (body) => { await api.updateCase(id, body); close(); toast('Dossier mis à jour.'); viewCaseDetail(main, id); });
          const close = openModal('Modifier le dossier', form, { wide: true });
        } }, 'Modifier')),
      ),
      tabs,
      panel,
    ),
  );
  setTab('overview');
  main.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Facturation                                                         */
/* ------------------------------------------------------------------ */

async function viewInvoices(main) {
  const perms = new Set(currentUser.permissions);
  const tableBody = h('tbody');

  async function load() {
    const rows = await guarded(() => api.invoices());
    clear(tableBody);
    if (!rows?.length) {
      tableBody.append(h('tr', null, h('td', { colspan: 6, class: 'empty-state' }, 'Aucune facture.')));
      return;
    }
    for (const i of rows) {
      tableBody.append(
        h(
          'tr',
          null,
          h('td', null, h('span', { class: 'mono' }, i.invoiceNumber)),
          h('td', null, i.clientName ?? '—'),
          h('td', null, i.caseTitle ?? '—'),
          h('td', null, fmtMoney(i.totalCents)),
          h('td', null, perms.has('billing.update')
            ? h('select', { onchange: async (e) => { await guarded(() => api.setInvoiceStatus(i.id, e.target.value)); toast('Statut mis à jour.'); load(); } },
                ...Object.entries(INVOICE_STATUS).map(([v, l]) => h('option', { value: v, selected: i.status === v }, l)))
            : statusDot(i.status, INVOICE_STATUS)),
          h('td', null, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Voir le PDF', onclick: () => guarded(() => openFile(`/invoices/${i.id}/pdf`)) }, icon('file'))),
        ),
      );
    }
  }

  const newBtn = perms.has('billing.create')
    ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const clients = await guarded(() => api.clients());
        const cases = await guarded(() => api.cases());
        const f = {
          clientId: h('select', { required: true }, h('option', { value: '' }, 'Sélectionner…'), ...(clients ?? []).map((c) => h('option', { value: c.id }, `${c.firstName} ${c.lastName}`))),
          caseId: h('select', null, h('option', { value: '' }, 'Aucun'), ...(cases ?? []).map((c) => h('option', { value: c.id }, c.title))),
          amount: h('input', { type: 'number', min: '0', step: '0.01', required: true, placeholder: '0.00' }),
          tax: h('input', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' }),
          dueAt: h('input', { type: 'date' }),
        };
        const errorBox = h('p', { class: 'form-error', hidden: true });
        const form = h(
          'form', { class: 'stacked-form', onsubmit: async (e) => {
            e.preventDefault();
            errorBox.hidden = true;
            try {
              await api.createInvoice({
                clientId: Number(f.clientId.value),
                caseId: f.caseId.value ? Number(f.caseId.value) : null,
                amountCents: Math.round(Number(f.amount.value) * 100),
                taxCents: Math.round(Number(f.tax.value || 0) * 100),
                dueAt: f.dueAt.value || null,
              });
              close();
              toast('Facture créée.');
              load();
            } catch (err) {
              errorBox.textContent = errorMessage(err);
              errorBox.hidden = false;
            }
          } },
          field('Client', f.clientId), field('Dossier (optionnel)', f.caseId),
          h('div', { class: 'form-row' }, field('Montant (CAD)', f.amount), field('Taxes (CAD)', f.tax)),
          field("Date d'échéance", f.dueAt),
          errorBox,
          h('button', { class: 'btn btn-primary', type: 'submit' }, 'Créer la facture'),
        );
        const close = openModal('Nouvelle facture', form);
      } }, icon('plus'), 'Nouvelle facture')
    : null;

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, 'Facturation'), newBtn),
      h(
        'div',
        { class: 'table-wrap' },
        h('table', null, h('thead', null, h('tr', null, h('th', null, 'Numéro'), h('th', null, 'Client'), h('th', null, 'Dossier'), h('th', null, 'Montant'), h('th', null, 'Statut'), h('th', null, 'PDF'))), tableBody),
      ),
    ),
  );
  await load();
  main.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Utilisateurs (admin)                                                */
/* ------------------------------------------------------------------ */

async function viewUsers(main) {
  const tableBody = h('tbody');

  async function load() {
    const rows = await guarded(() => api.users());
    clear(tableBody);
    for (const u of rows ?? []) {
      tableBody.append(
        h(
          'tr',
          null,
          h('td', null, h('strong', null, `${u.firstName} ${u.lastName}`)),
          h('td', null, u.email),
          h('td', null, ROLE_LABEL[u.role] ?? u.role),
          h('td', null, h('span', { class: `status status-${u.isActive ? 'active' : 'inactive'}` }, h('span', { class: 'status-dot' }), u.isActive ? 'Actif' : 'Désactivé')),
          h('td', null, h('button', { class: 'link-btn', type: 'button', onclick: async () => {
            await guarded(() => api.updateUser(u.id, { isActive: !u.isActive }));
            load();
          } }, u.isActive ? 'Désactiver' : 'Activer')),
        ),
      );
    }
  }

  const newBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
    const f = {
      firstName: h('input', { required: true }), lastName: h('input', { required: true }),
      email: h('input', { type: 'email', required: true }), password: h('input', { type: 'password', required: true, minlength: 8 }),
      role: h('select', null, ...['ADMIN', 'LAWYER', 'ASSISTANT', 'ACCOUNTANT'].map((r) => h('option', { value: r }, ROLE_LABEL[r]))),
    };
    const errorBox = h('p', { class: 'form-error', hidden: true });
    const form = h(
      'form', { class: 'stacked-form', onsubmit: async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        try {
          await api.createUser({ firstName: f.firstName.value.trim(), lastName: f.lastName.value.trim(), email: f.email.value.trim(), password: f.password.value, role: f.role.value });
          close();
          toast('Utilisateur créé.');
          load();
        } catch (err) {
          errorBox.textContent = errorMessage(err);
          errorBox.hidden = false;
        }
      } },
      h('div', { class: 'form-row' }, field('Prénom', f.firstName), field('Nom', f.lastName)),
      field('Courriel', f.email), field('Mot de passe', f.password), field('Rôle', f.role),
      errorBox,
      h('button', { class: 'btn btn-primary', type: 'submit' }, "Créer l'utilisateur"),
    );
    const close = openModal('Nouvel utilisateur', form);
  } }, icon('plus'), 'Nouvel utilisateur');

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, 'Utilisateurs'), newBtn),
      h(
        'div',
        { class: 'table-wrap' },
        h('table', null, h('thead', null, h('tr', null, h('th', null, 'Nom'), h('th', null, 'Courriel'), h('th', null, 'Rôle'), h('th', null, 'Statut'), h('th', null, ''))), tableBody),
      ),
    ),
  );
  await load();
  main.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Journal d'audit (admin)                                             */
/* ------------------------------------------------------------------ */

async function viewAudit(main) {
  const tableBody = h('tbody');
  let offset = 0;
  const LIMIT = 40;
  const moreBtn = h('button', { class: 'btn more', type: 'button' }, 'Afficher plus');

  async function load(reset = true) {
    if (reset) offset = 0;
    const rows = await guarded(() => api.auditLogs({ limit: LIMIT, offset }));
    if (reset) clear(tableBody);
    if (reset && !rows?.length) {
      tableBody.append(h('tr', null, h('td', { colspan: 5, class: 'empty-state' }, 'Aucune entrée.')));
    }
    for (const a of rows ?? []) {
      tableBody.append(
        h(
          'tr',
          null,
          h('td', { class: 'muted' }, fmtDateTime(a.createdAt)),
          h('td', null, a.userName),
          h('td', null, h('span', { class: 'mono' }, a.action)),
          h('td', null, `${a.resourceType}${a.resourceId ? ` #${a.resourceId}` : ''}`),
          h('td', { class: 'muted' }, a.ipAddress ?? '—'),
        ),
      );
    }
    offset += LIMIT;
    moreBtn.hidden = (rows?.length ?? 0) < LIMIT;
  }
  moreBtn.addEventListener('click', () => load(false));

  clear(main).append(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, "Journal d'audit")),
      h(
        'div',
        { class: 'table-wrap' },
        h('table', null, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Utilisateur'), h('th', null, 'Action'), h('th', null, 'Ressource'), h('th', null, 'IP'))), tableBody),
      ),
      moreBtn,
    ),
  );
  await load();
  main.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

route();
