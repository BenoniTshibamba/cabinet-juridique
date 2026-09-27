import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, HttpError } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const toNotif = (n) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  caseId: n.related_case_id,
  isRead: n.is_read,
  createdAt: n.created_at,
});

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    res.json(rows.map(toNotif));
  } catch (err) {
    next(err);
  }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false', [req.user.id]);
    res.json({ count: rows[0].n });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const { rows } = await query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Notification introuvable.');
    res.json(toNotif(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
