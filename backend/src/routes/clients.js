import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, HttpError } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

const toClient = (c) => ({
  id: c.id,
  firstName: c.first_name,
  lastName: c.last_name,
  email: c.email,
  phone: c.phone,
  company: c.company,
  address: c.address,
  notes: c.notes,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

router.get('/', requirePermission('clients.read'), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR company ILIKE $1`;
    }
    const { rows } = await query(`SELECT * FROM clients ${where} ORDER BY created_at DESC LIMIT 200`, params);
    res.json(rows.map(toClient));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('clients.read'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Client introuvable.');
    res.json(toClient(rows[0]));
  } catch (err) {
    next(err);
  }
});

const clientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  company: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/', requirePermission('clients.create'), async (req, res, next) => {
  try {
    const b = clientSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO clients (first_name, last_name, email, phone, company, address, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.firstName, b.lastName, b.email || null, b.phone ?? null, b.company ?? null, b.address ?? null, b.notes ?? null, req.user.id],
    );
    await logAudit({ userId: req.user.id, action: 'CLIENT_CREATED', resourceType: 'client', resourceId: rows[0].id, newValues: toClient(rows[0]), ip: req.ip });
    res.status(201).json(toClient(rows[0]));
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', err.issues[0].message) : err);
  }
});

router.patch('/:id', requirePermission('clients.update'), async (req, res, next) => {
  try {
    const b = clientSchema.partial().parse(req.body);
    const { rows: before } = await query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!before[0]) throw new HttpError(404, 'not_found', 'Client introuvable.');

    const { rows } = await query(
      `UPDATE clients SET
         first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name),
         email = COALESCE($3, email), phone = COALESCE($4, phone), company = COALESCE($5, company),
         address = COALESCE($6, address), notes = COALESCE($7, notes), updated_at = now()
       WHERE id = $8 RETURNING *`,
      [b.firstName, b.lastName, b.email, b.phone, b.company, b.address, b.notes, req.params.id],
    );
    await logAudit({ userId: req.user.id, action: 'CLIENT_UPDATED', resourceType: 'client', resourceId: req.params.id, oldValues: toClient(before[0]), newValues: toClient(rows[0]), ip: req.ip });
    res.json(toClient(rows[0]));
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', err.issues[0].message) : err);
  }
});

router.delete('/:id', requirePermission('clients.delete'), async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM clients WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Client introuvable.');
    await logAudit({ userId: req.user.id, action: 'CLIENT_DELETED', resourceType: 'client', resourceId: req.params.id, oldValues: toClient(rows[0]), ip: req.ip });
    res.status(204).end();
  } catch (err) {
    // Un client lié à des dossiers ne peut pas être supprimé (contrainte de clé étrangère).
    if (err.code === '23503') return next(new HttpError(409, 'has_dependencies', 'Ce client a des dossiers associés et ne peut pas être supprimé.'));
    next(err);
  }
});

export default router;
