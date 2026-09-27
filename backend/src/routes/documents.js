import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, HttpError } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { loadCaseOr404, assertVisible } from './cases.js';
import { indexDocument } from './ai.js';

const router = Router();
router.use(requireAuth);

const UPLOAD_ROOT = resolve(process.env.UPLOAD_DIR ?? './uploads');
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.png', '.jpg', '.jpeg']);
const MAX_SIZE = 25 * 1024 * 1024; // 25 Mo

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = join(UPLOAD_ROOT, String(req.params.caseId));
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  // Nom de fichier généré aléatoirement : jamais le nom fourni par le client, pour éviter toute
  // traversée de chemin ou collision. Le nom d'origine est conservé séparément en base (original_name).
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, 'invalid_file_type', `Type de fichier non autorisé : ${ext || 'inconnu'}.`));
    cb(null, true);
  },
});

const toDoc = (d) => ({
  id: d.id,
  name: d.name,
  originalName: d.original_name,
  mimeType: d.mime_type,
  sizeBytes: Number(d.size_bytes),
  version: d.version,
  uploadedBy: d.uploaded_by_name,
  createdAt: d.created_at,
  indexedAt: d.indexed_at ?? null,
});

router.get('/cases/:caseId/documents', requirePermission('documents.read'), async (req, res, next) => {
  try {
    const c = await loadCaseOr404(req.params.caseId);
    assertVisible(req.user, c);
    const { rows } = await query(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS uploaded_by_name
       FROM documents d JOIN users u ON u.id = d.uploaded_by
       WHERE d.case_id = $1 ORDER BY d.created_at DESC`,
      [req.params.caseId],
    );
    res.json(rows.map(toDoc));
  } catch (err) {
    next(err);
  }
});

router.post('/cases/:caseId/documents', requirePermission('documents.upload'), (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err instanceof multer.MulterError) {
        return next(new HttpError(400, 'upload_error', err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (25 Mo max).' : err.message));
      }
      if (err) return next(err);
      if (!req.file) throw new HttpError(400, 'missing_file', 'Aucun fichier reçu.');

      const c = await loadCaseOr404(req.params.caseId);
      assertVisible(req.user, c);

      // Versionnement simple : un même nom de document dans le dossier incrémente la version.
      const { rows: existing } = await query(
        'SELECT * FROM documents WHERE case_id = $1 AND name = $2 ORDER BY version DESC LIMIT 1',
        [req.params.caseId, req.file.originalname],
      );
      const version = existing[0] ? existing[0].version + 1 : 1;

      const { rows } = await query(
        `INSERT INTO documents (case_id, name, original_name, mime_type, size_bytes, storage_path, version, replaces_id, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.params.caseId, req.file.originalname, req.file.originalname, req.file.mimetype, req.file.size, req.file.path, version, existing[0]?.id ?? null, req.user.id],
      );
      await logAudit({
        userId: req.user.id, action: 'DOCUMENT_UPLOADED', resourceType: 'document', resourceId: rows[0].id,
        newValues: { name: rows[0].name, version, caseId: Number(req.params.caseId) }, ip: req.ip,
      });

      // L’analyse RAG démarre automatiquement. Si Ollama n’est pas lancé ou si le
      // fichier n’est pas exploitable par le RAG, l’upload reste valide et le client
      // reçoit une indication claire : il pourra relancer l’analyse plus tard.
      let indexing = { status: 'pending', error: null };
      try {
        const result = await indexDocument(rows[0]);
        indexing = { status: 'ready', error: null, ...result };
      } catch (indexErr) {
        console.warn(`RAG: impossible d’indexer le document ${rows[0].id}:`, indexErr?.message || indexErr);
        indexing = { status: 'pending', error: indexErr?.message || 'Analyse non terminée.' };
      }

      res.status(201).json({
        ...toDoc({ ...rows[0], uploaded_by_name: `${req.user.firstName} ${req.user.lastName}` }),
        indexing,
      });
    } catch (e) {
      next(e);
    }
  });
});

router.get('/documents/:id/download', requirePermission('documents.read'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Document introuvable.');
    const c = await loadCaseOr404(rows[0].case_id);
    assertVisible(req.user, c);
    if (!existsSync(rows[0].storage_path)) throw new HttpError(404, 'file_missing', 'Fichier introuvable sur le serveur.');

    await logAudit({ userId: req.user.id, action: 'DOCUMENT_DOWNLOADED', resourceType: 'document', resourceId: rows[0].id, ip: req.ip });
    res.download(rows[0].storage_path, rows[0].original_name);
  } catch (err) {
    next(err);
  }
});

router.delete('/documents/:id', requirePermission('documents.delete'), async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM documents WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Document introuvable.');
    if (existsSync(rows[0].storage_path)) unlinkSync(rows[0].storage_path);
    await logAudit({ userId: req.user.id, action: 'DOCUMENT_DELETED', resourceType: 'document', resourceId: rows[0].id, oldValues: { name: rows[0].name }, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
