import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requirePermission('dashboard.read'));

router.get('/', async (req, res, next) => {
  try {
    const { user } = req;
    const caseScope = user.role === 'LAWYER' ? 'WHERE lawyer_id = $1' : user.role === 'CLIENT' ? 'WHERE client_id = $1' : '';
    const caseParams = caseScope ? [user.role === 'CLIENT' ? user.clientId ?? -1 : user.id] : [];

    const [cases, clientsCount, unpaidInvoices, documentsCount, recentCases] = await Promise.all([
      query(`SELECT status, count(*)::int AS n FROM cases ${caseScope} GROUP BY status`, caseParams),
      user.role === 'CLIENT' ? Promise.resolve({ rows: [{ n: 0 }] }) : query('SELECT count(*)::int AS n FROM clients'),
      query(
        `SELECT count(*)::int AS n, COALESCE(sum(amount_cents + tax_cents), 0)::bigint AS total
         FROM invoices WHERE status NOT IN ('PAYEE','ANNULEE') ${user.role === 'CLIENT' ? 'AND client_id = $1' : ''}`,
        user.role === 'CLIENT' ? [user.clientId ?? -1] : [],
      ),
      query(
        `SELECT count(*)::int AS n FROM documents d JOIN cases cs ON cs.id = d.case_id ${caseScope.replace('WHERE', 'WHERE cs.')}`,
        caseParams,
      ),
      query(
        `SELECT cs.id, cs.title, cs.status, cs.updated_at, cl.first_name, cl.last_name
         FROM cases cs JOIN clients cl ON cl.id = cs.client_id
         ${caseScope} ORDER BY cs.updated_at DESC LIMIT 6`,
        caseParams,
      ),
    ]);

    const statusCounts = Object.fromEntries(cases.rows.map((r) => [r.status, r.n]));
    const activeStatuses = ['NOUVEAU', 'EN_COURS', 'EN_ATTENTE'];

    res.json({
      cases: {
        total: cases.rows.reduce((s, r) => s + r.n, 0),
        active: activeStatuses.reduce((s, k) => s + (statusCounts[k] ?? 0), 0),
        completed: statusCounts.TERMINE ?? 0,
        byStatus: statusCounts,
      },
      clients: { total: clientsCount.rows[0].n },
      billing: { unpaidCount: unpaidInvoices.rows[0].n, unpaidCents: Number(unpaidInvoices.rows[0].total) },
      documents: { total: documentsCount.rows[0].n },
      recentCases: recentCases.rows.map((c) => ({
        id: c.id, title: c.title, status: c.status, clientName: `${c.first_name} ${c.last_name}`, updatedAt: c.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
