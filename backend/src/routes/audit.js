import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requirePermission('audit.read'));

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const params = [limit, offset];
    let where = '';
    if (req.query.resourceType) {
      params.push(req.query.resourceType);
      where = `WHERE a.resource_type = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT a.*, u.first_name, u.last_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    res.json(
      rows.map((a) => ({
        id: a.id,
        userName: a.first_name ? `${a.first_name} ${a.last_name}` : 'Système',
        action: a.action,
        resourceType: a.resource_type,
        resourceId: a.resource_id,
        oldValues: a.old_values,
        newValues: a.new_values,
        ipAddress: a.ip_address,
        createdAt: a.created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
