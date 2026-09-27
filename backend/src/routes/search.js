import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, HttpError } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) throw new HttpError(400, 'missing_query', 'Paramètre "q" requis.');
    const like = `%${q}%`;
    const { permissions, role, id: userId, clientId } = req.user;
    const results = { clients: [], cases: [], documents: [] };

    if (permissions.has('clients.read')) {
      const { rows } = await query(
        `SELECT id, first_name, last_name, email FROM clients
         WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 LIMIT 10`,
        [like],
      );
      results.clients = rows.map((c) => ({ id: c.id, label: `${c.first_name} ${c.last_name}`, meta: c.email }));
    }

    if (permissions.has('cases.read')) {
      const scope = role === 'LAWYER' ? 'AND cs.lawyer_id = $2' : role === 'CLIENT' ? 'AND cs.client_id = $2' : '';
      const params = scope ? [like, role === 'CLIENT' ? clientId ?? -1 : userId] : [like];
      const { rows } = await query(
        `SELECT cs.id, cs.title, cs.case_number FROM cases cs WHERE (cs.title ILIKE $1 OR cs.case_number ILIKE $1) ${scope} LIMIT 10`,
        params,
      );
      results.cases = rows.map((c) => ({ id: c.id, label: c.title, meta: c.case_number }));
    }

    if (permissions.has('documents.read')) {
      const scope = role === 'LAWYER' ? 'AND cs.lawyer_id = $2' : role === 'CLIENT' ? 'AND cs.client_id = $2' : '';
      const params = scope ? [like, role === 'CLIENT' ? clientId ?? -1 : userId] : [like];
      const { rows } = await query(
        `SELECT d.id, d.name, d.case_id FROM documents d JOIN cases cs ON cs.id = d.case_id
         WHERE d.name ILIKE $1 ${scope} LIMIT 10`,
        params,
      );
      results.documents = rows.map((d) => ({ id: d.id, label: d.name, meta: `Dossier #${d.case_id}`, caseId: d.case_id }));
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
