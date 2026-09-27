import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, HttpError } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { ROLE_PERMISSIONS } from '../utils/permissions.js';

const router = Router();

const REFRESH_MS = () => Number(process.env.JWT_REFRESH_EXPIRES_DAYS ?? 30) * 24 * 60 * 60 * 1000;

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  });
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_MS());
  await query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hashToken(token),
    expiresAt,
  ]);
  return token;
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await query(
      `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`,
      [email.toLowerCase()],
    );
    const user = rows[0];
    // Message volontairement identique pour un email inconnu ou un mot de passe erroné.
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'invalid_credentials', 'Identifiants invalides.');
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    await logAudit({ userId: user.id, action: 'LOGIN', resourceType: 'auth', resourceId: user.id, ip: req.ip });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        clientId: user.client_id,
        permissions: ROLE_PERMISSIONS[user.role] ?? [],
      },
    });
  } catch (err) {
    if (!(err instanceof z.ZodError) && !(err instanceof HttpError)) console.error('AUTH LOGIN ERROR:', err);
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', 'Email ou mot de passe manquant.') : err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) throw new HttpError(400, 'missing_token', 'refreshToken requis.');

    const hash = hashToken(refreshToken);
    const { rows } = await query(
      `SELECT rt.*, u.role_id, r.name AS role FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id JOIN roles r ON r.id = u.role_id
       WHERE rt.token_hash = $1`,
      [hash],
    );
    const stored = rows[0];
    if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
      throw new HttpError(401, 'invalid_refresh', 'Session expirée, veuillez vous reconnecter.');
    }

    // Rotation : le jeton utilisé est révoqué, un nouveau est émis.
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [stored.id]);
    const accessToken = signAccessToken({ id: stored.user_id, role: stored.role });
    const newRefreshToken = await issueRefreshToken(stored.user_id);
    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (refreshToken) {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashToken(refreshToken)]);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  const { permissions, scoped, ...user } = req.user;
  res.json({ ...user, permissions: [...permissions] });
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      throw new HttpError(401, 'invalid_credentials', 'Mot de passe actuel incorrect.');
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.user.id]);
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
    await logAudit({ userId: req.user.id, action: 'PASSWORD_CHANGED', resourceType: 'auth', resourceId: req.user.id, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', 'Le nouveau mot de passe doit contenir au moins 8 caractères.') : err);
  }
});

export default router;
