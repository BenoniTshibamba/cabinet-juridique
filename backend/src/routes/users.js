import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, HttpError } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { ROLES } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

const STAFF_ROLES = ROLES.filter((r) => r !== 'CLIENT');

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  firstName: u.first_name,
  lastName: u.last_name,
  role: u.role,
  isActive: u.is_active,
  createdAt: u.created_at,
});

router.get('/', requirePermission('users.read'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name != 'CLIENT' ORDER BY u.created_at DESC`,
    );
    res.json(rows.map(publicUser));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(STAFF_ROLES),
});

router.post('/', requirePermission('users.create'), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const { rows: roleRows } = await query('SELECT id FROM roles WHERE name = $1', [body.role]);
    const hash = await bcrypt.hash(body.password, 12);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.email.toLowerCase(), hash, body.firstName, body.lastName, roleRows[0].id],
    );
    const user = { ...rows[0], role: body.role };
    await logAudit({ userId: req.user.id, action: 'USER_CREATED', resourceType: 'user', resourceId: user.id, newValues: publicUser(user), ip: req.ip });
    res.status(201).json(publicUser(user));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'invalid_body', err.issues[0].message));
    if (err.code === '23505') return next(new HttpError(409, 'email_taken', 'Cet email est déjà utilisé.'));
    next(err);
  }
});

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(STAFF_ROLES).optional(),
  isActive: z.boolean().optional(),
});

router.patch('/:id', requirePermission('users.update'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = updateSchema.parse(req.body);
    const { rows: before } = await query(
      `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id],
    );
    if (!before[0]) throw new HttpError(404, 'not_found', 'Utilisateur introuvable.');

    let roleId;
    if (body.role) {
      const { rows } = await query('SELECT id FROM roles WHERE name = $1', [body.role]);
      roleId = rows[0].id;
    }
    const { rows } = await query(
      `UPDATE users SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         role_id    = COALESCE($3, role_id),
         is_active  = COALESCE($4, is_active),
         updated_at = now()
       WHERE id = $5 RETURNING *`,
      [body.firstName, body.lastName, roleId, body.isActive, id],
    );
    const after = { ...rows[0], role: body.role ?? before[0].role };
    await logAudit({
      userId: req.user.id, action: 'USER_UPDATED', resourceType: 'user', resourceId: id,
      oldValues: publicUser(before[0]), newValues: publicUser(after), ip: req.ip,
    });
    res.json(publicUser(after));
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', err.issues[0].message) : err);
  }
});

export default router;
