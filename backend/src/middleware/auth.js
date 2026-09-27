import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';
import { ROLE_PERMISSIONS, SCOPED_ROLES } from '../utils/permissions.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Vérifie le jeton d'accès et charge l'utilisateur (rôle, statut actif) sur req.user. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'missing_token', 'Authentification requise.');

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      throw new HttpError(401, 'invalid_token', 'Jeton invalide ou expiré.');
    }

    const { rows } = await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.client_id, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.is_active) throw new HttpError(401, 'invalid_token', 'Compte introuvable ou désactivé.');

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      clientId: user.client_id,
      permissions: new Set(ROLE_PERMISSIONS[user.role] ?? []),
      scoped: SCOPED_ROLES.has(user.role),
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** À utiliser après requireAuth : exige une permission précise (voir utils/permissions.js). */
export function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user?.permissions.has(code)) {
      return next(new HttpError(403, 'forbidden', `Permission requise : ${code}.`));
    }
    next();
  };
}
