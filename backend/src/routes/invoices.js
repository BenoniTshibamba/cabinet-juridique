import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, HttpError } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

const toInvoice = (i) => ({
  id: i.id,
  invoiceNumber: i.invoice_number,
  caseId: i.case_id,
  caseTitle: i.case_title,
  clientId: i.client_id,
  clientName: i.client_first_name ? `${i.client_first_name} ${i.client_last_name}` : undefined,
  amountCents: Number(i.amount_cents),
  taxCents: Number(i.tax_cents),
  totalCents: Number(i.amount_cents) + Number(i.tax_cents),
  status: i.status,
  issuedAt: i.issued_at,
  dueAt: i.due_at,
  paidAt: i.paid_at,
  createdAt: i.created_at,
});

function scopeClause(user, idx) {
  if (user.role === 'CLIENT') return { sql: `AND inv.client_id = $${idx}`, param: user.clientId ?? -1 };
  return { sql: '', param: null };
}

router.get('/', requirePermission('billing.read'), async (req, res, next) => {
  try {
    const params = [];
    const filters = [];
    if (req.query.status) {
      params.push(req.query.status);
      filters.push(`inv.status = $${params.length}`);
    }
    const scope = scopeClause(req.user, params.length + 1);
    if (scope.param !== null) params.push(scope.param);

    const { rows } = await query(
      `SELECT inv.*, cl.first_name AS client_first_name, cl.last_name AS client_last_name, cs.title AS case_title
       FROM invoices inv JOIN clients cl ON cl.id = inv.client_id LEFT JOIN cases cs ON cs.id = inv.case_id
       WHERE 1=1 ${filters.map((f) => `AND ${f}`).join(' ')} ${scope.sql}
       ORDER BY inv.created_at DESC LIMIT 200`,
      params,
    );
    res.json(rows.map(toInvoice));
  } catch (err) {
    next(err);
  }
});

async function loadInvoiceOr404(id) {
  const { rows } = await query(
    `SELECT inv.*, cl.first_name AS client_first_name, cl.last_name AS client_last_name, cs.title AS case_title
     FROM invoices inv JOIN clients cl ON cl.id = inv.client_id LEFT JOIN cases cs ON cs.id = inv.case_id
     WHERE inv.id = $1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Facture introuvable.');
  return rows[0];
}

router.get('/:id', requirePermission('billing.read'), async (req, res, next) => {
  try {
    const row = await loadInvoiceOr404(req.params.id);
    if (req.user.role === 'CLIENT' && row.client_id !== req.user.clientId) throw new HttpError(403, 'forbidden', 'Accès refusé.');
    res.json(toInvoice(row));
  } catch (err) {
    next(err);
  }
});

const genInvoiceNumber = () => `FAC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;

const invoiceSchema = z.object({
  clientId: z.number().int(),
  caseId: z.number().int().nullable().optional(),
  amountCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative().optional(),
  dueAt: z.string().optional().nullable(),
});

router.post('/', requirePermission('billing.create'), async (req, res, next) => {
  try {
    const b = invoiceSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO invoices (invoice_number, client_id, case_id, amount_cents, tax_cents, due_at, created_by, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_DATE) RETURNING id`,
      [genInvoiceNumber(), b.clientId, b.caseId ?? null, b.amountCents, b.taxCents ?? 0, b.dueAt ?? null, req.user.id],
    );
    const created = await loadInvoiceOr404(rows[0].id);
    await logAudit({ userId: req.user.id, action: 'INVOICE_CREATED', resourceType: 'invoice', resourceId: created.id, newValues: toInvoice(created), ip: req.ip });
    res.status(201).json(toInvoice(created));
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', err.issues[0].message) : err);
  }
});

const statusSchema = z.object({ status: z.enum(['BROUILLON', 'ENVOYEE', 'PAYEE', 'PARTIELLEMENT_PAYEE', 'EN_RETARD', 'ANNULEE']) });

router.patch('/:id/status', requirePermission('billing.update'), async (req, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const before = await loadInvoiceOr404(req.params.id);
    const paidAt = status === 'PAYEE' ? new Date() : before.paid_at;
    const { rows } = await query('UPDATE invoices SET status = $1, paid_at = $2, updated_at = now() WHERE id = $3 RETURNING id', [status, paidAt, req.params.id]);
    const after = await loadInvoiceOr404(rows[0].id);
    await logAudit({ userId: req.user.id, action: 'INVOICE_STATUS_CHANGED', resourceType: 'invoice', resourceId: after.id, oldValues: { status: before.status }, newValues: { status }, ip: req.ip });
    res.json(toInvoice(after));
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', 'Statut invalide.') : err);
  }
});

const money = (cents) => (cents / 100).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

router.get('/:id/pdf', requirePermission('billing.read'), async (req, res, next) => {
  try {
    const inv = await loadInvoiceOr404(req.params.id);
    if (req.user.role === 'CLIENT' && inv.client_id !== req.user.clientId) throw new HttpError(403, 'forbidden', 'Accès refusé.');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_number}.pdf"`);
    const doc = new PDFDocument({ margin: 56 });
    doc.pipe(res);

    doc.fontSize(20).fillColor('#1B2233').text('Cabinet Élite Juridique', { continued: false });
    doc.fontSize(10).fillColor('#5A6472').text('Montréal, QC');
    doc.moveDown(1.5);
    doc.fontSize(16).fillColor('#1B2233').text(`Facture ${inv.invoice_number}`);
    doc.fontSize(10).fillColor('#5A6472').text(`Émise le ${inv.issued_at ? new Date(inv.issued_at).toLocaleDateString('fr-CA') : '—'}`);
    if (inv.due_at) doc.text(`Échéance : ${new Date(inv.due_at).toLocaleDateString('fr-CA')}`);
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#1B2233').text(`Client : ${inv.client_first_name} ${inv.client_last_name}`);
    if (inv.case_title) doc.text(`Dossier : ${inv.case_title}`);
    doc.moveDown(1.5);

    doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#D3D8E0').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).text('Honoraires professionnels', 56, doc.y, { continued: true }).text(money(inv.amount_cents), { align: 'right' });
    doc.text('Taxes', 56, doc.y, { continued: true }).text(money(inv.tax_cents), { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#D3D8E0').stroke();
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor('#2A3FA3').text('Total', 56, doc.y, { continued: true }).text(money(Number(inv.amount_cents) + Number(inv.tax_cents)), { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(9).fillColor('#5A6472').text(`Statut : ${inv.status}`);

    await logAudit({ userId: req.user.id, action: 'INVOICE_PDF_GENERATED', resourceType: 'invoice', resourceId: inv.id, ip: req.ip });
    doc.end();
  } catch (err) {
    next(err);
  }
});

export default router;
