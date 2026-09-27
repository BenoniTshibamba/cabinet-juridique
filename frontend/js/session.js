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

export const getSession = () => session;
export const getUser = () => session?.user ?? null;

export function setSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : la session reste valable pour cet onglet */
  }
}

export function updateTokens(accessToken, refreshToken) {
  if (!session) return;
  setSession({ ...session, accessToken, refreshToken });
}
