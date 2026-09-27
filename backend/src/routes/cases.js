import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, HttpError } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { notify } from '../services/notify.js';

const router = Router();
router.use(requireAuth);

const toCase = (c) => ({
  id: c.id,
  caseNumber: c.case_number,
  title: c.title,
  clientId: c.client_id,
  clientName: c.client_first_name ? `${c.client_first_name} ${c.client_last_name}` : undefined,
  lawyerId: c.lawyer_id,
  lawyerName: c.lawyer_first_name ? `${c.lawyer_first_name} ${c.lawyer_last_name}` : undefined,
  caseType: c.case_type,
  description: c.description,
  status: c.status,
  priority: c.priority,
  dueDate: c.due_date,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

/** Ajoute la clause de restriction adaptée au rôle courant (dossiers visibles uniquement). */
function scopeClause(user, paramIndex) {
  if (user.role === 'LAWYER') return { sql: `AND cs.lawyer_id = $${paramIndex}`, param: user.id };
  if (user.role === 'CLIENT') return { sql: `AND cs.client_id = $${paramIndex}`, param: user.clientId ?? -1 };
  return { sql: '', param: null };
}

router.get('/', requirePermission('cases.read'), async (req, res, next) => {
  try {
    const params = [];
    const filters = [];
    if (req.query.status) {
      params.push(req.query.status);
      filters.push(`cs.status = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      filters.push(`(cs.title ILIKE $${params.length} OR cs.case_number ILIKE $${params.length})`);
    }
    const scope = scopeClause(req.user, params.length + 1);
    if (scope.param !== null) params.push(scope.param);

    const { rows } = await query(
      `SELECT cs.*, cl.first_name AS client_first_name, cl.last_name AS client_last_name,
              lw.first_name AS lawyer_first_name, lw.last_name AS lawyer_last_name
       FROM cases cs
       JOIN clients cl ON cl.id = cs.client_id
       LEFT JOIN users lw ON lw.id = cs.lawyer_id
       WHERE 1=1 ${filters.map((f) => `AND ${f}`).join(' ')} ${scope.sql}
       ORDER BY cs.created_at DESC LIMIT 200`,
      params,
    );
    res.json(rows.map(toCase));
  } catch (err) {
    next(err);
  }
});

async function loadCaseOr404(id) {
  const { rows } = await query(
    `SELECT cs.*, cl.first_name AS client_first_name, cl.last_name AS client_last_name,
            lw.first_name AS lawyer_first_name, lw.last_name AS lawyer_last_name
     FROM cases cs JOIN clients cl ON cl.id = cs.client_id LEFT JOIN users lw ON lw.id = cs.lawyer_id
     WHERE cs.id = $1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Dossier introuvable.');
  return rows[0];
}

function assertVisible(user, row) {
  if (user.role === 'LAWYER' && row.lawyer_id !== user.id) throw new HttpError(403, 'forbidden', "Vous n'êtes pas responsable de ce dossier.");
  if (user.role === 'CLIENT' && row.client_id !== user.clientId) throw new HttpError(403, 'forbidden', 'Accès refusé à ce dossier.');
}

router.get('/:id', requirePermission('cases.read'), async (req, res, next) => {
  try {
    const row = await loadCaseOr404(req.params.id);
    assertVisible(req.user, row);
    res.json(toCase(row));
  } catch (err) {
    next(err);
  }
});

const genCaseNumber = () => `CEJ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

const caseSchema = z.object({
  title: z.string().min(1),
  clientId: z.number().int(),
  lawyerId: z.number().int().nullable().optional(),
  caseType: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['BASSE', 'NORMALE', 'HAUTE', 'URGENTE']).optional(),
  dueDate: z.string().optional().nullable(),
});

router.post('/', requirePermission('cases.create'), async (req, res, next) => {
  try {
    const b = caseSchema.parse(req.body);
    const caseNumber = genCaseNumber();
    const { rows } = await query(
      `INSERT INTO cases (case_number, title, client_id, lawyer_id, case_type, description, priority, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'NORMALE'),$8,$9) RETURNING *`,
      [caseNumber, b.title, b.clientId, b.lawyerId ?? null, b.caseType ?? null, b.description ?? null, b.priority, b.dueDate ?? null, req.user.id],
    );
    const created = await loadCaseOr404(rows[0].id);
    await logAudit({ userId: req.user.id, action: 'CASE_CREATED', resourceType: 'case', resourceId: created.id, newValues: toCase(created), ip: req.ip });
    if (created.lawyer_id) {
      await notify(created.lawyer_id, { type: 'CASE_ASSIGNED', title: `Nouveau dossier assigné : ${created.title}`, caseId: created.id });
    }
    res.status(201).json(toCase(created));
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', err.issues[0].message) : err);
  }
});

const updateSchema = caseSchema.partial().extend({
  status: z.enum(['NOUVEAU', 'EN_COURS', 'EN_ATTENTE', 'TERMINE', 'ARCHIVE']).optional(),
});

router.patch('/:id', requirePermission('cases.update'), async (req, res, next) => {
  try {
    const before = await loadCaseOr404(req.params.id);
    assertVisible(req.user, before);
    const b = updateSchema.parse(req.body);

    const { rows } = await query(
      `UPDATE cases SET
         title = COALESCE($1, title), lawyer_id = COALESCE($2, lawyer_id), case_type = COALESCE($3, case_type),
         description = COALESCE($4, description), status = COALESCE($5, status), priority = COALESCE($6, priority),
         due_date = COALESCE($7, due_date), updated_at = now()
       WHERE id = $8 RETURNING *`,
      [b.title, b.lawyerId, b.caseType, b.description, b.status, b.priority, b.dueDate, req.params.id],
    );
    const after = await loadCaseOr404(rows[0].id);
    await logAudit({ userId: req.user.id, action: 'CASE_UPDATED', resourceType: 'case', resourceId: after.id, oldValues: toCase(before), newValues: toCase(after), ip: req.ip });
    if (b.lawyerId && b.lawyerId !== before.lawyer_id) {
      await notify(b.lawyerId, { type: 'CASE_ASSIGNED', title: `Dossier assigné : ${after.title}`, caseId: after.id });
    }
    res.json(toCase(after));
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', err.issues[0].message) : err);
  }
});

router.delete('/:id', requirePermission('cases.delete'), async (req, res, next) => {
  try {
    const before = await loadCaseOr404(req.params.id);
    await query('DELETE FROM cases WHERE id = $1', [req.params.id]);
    await logAudit({ userId: req.user.id, action: 'CASE_DELETED', resourceType: 'case', resourceId: req.params.id, oldValues: toCase(before), ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/* ---- Notes de dossier ---- */

router.get('/:id/notes', requirePermission('cases.read'), async (req, res, next) => {
  try {
    const row = await loadCaseOr404(req.params.id);
    assertVisible(req.user, row);
    const { rows } = await query(
      `SELECT n.*, u.first_name, u.last_name FROM case_notes n JOIN users u ON u.id = n.author_id
       WHERE n.case_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id],
    );
    res.json(rows.map((n) => ({ id: n.id, content: n.content, authorName: `${n.first_name} ${n.last_name}`, createdAt: n.created_at })));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/notes', requirePermission('cases.update'), async (req, res, next) => {
  try {
    const row = await loadCaseOr404(req.params.id);
    assertVisible(req.user, row);
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
    const { rows } = await query(
      `INSERT INTO case_notes (case_id, author_id, content) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.user.id, content],
    );
    await logAudit({ userId: req.user.id, action: 'CASE_NOTE_ADDED', resourceType: 'case', resourceId: req.params.id, newValues: { content }, ip: req.ip });
    res.status(201).json({ id: rows[0].id, content: rows[0].content, authorName: `${req.user.firstName} ${req.user.lastName}`, createdAt: rows[0].created_at });
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', 'Le contenu de la note est requis.') : err);
  }
});

export default router;
export { loadCaseOr404, assertVisible };
