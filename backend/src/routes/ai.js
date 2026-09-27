import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, HttpError } from '../middleware/auth.js';
import { loadCaseOr404, assertVisible } from './cases.js';
import { chat, embed, ollamaConfig, ollamaStatus } from '../services/ollama.js';
import { indexDocument } from '../services/rag.js';

const router = Router();
router.use(requireAuth);

router.get('/status', requirePermission('ai.ask'), async (req, res) => {
  const status = await ollamaStatus();
  res.json({ ...status, configured: status.available && status.chatModelInstalled && status.embeddingModelInstalled });
});

router.post('/index-document/:id', requirePermission('ai.manage'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Document introuvable.');
    const c = await loadCaseOr404(rows[0].case_id);
    assertVisible(req.user, c);
    const result = await indexDocument(rows[0]);
    res.json({ indexed: true, ...result });
  } catch (err) { next(err); }
});

router.post('/ask', requirePermission('ai.ask'), async (req, res, next) => {
  try {
    const b = z.object({
      question: z.string().trim().min(2).max(5000),
      caseId: z.coerce.number().int().positive().optional(),
    }).parse(req.body);

    let docs = [];
    if (b.caseId) {
      const c = await loadCaseOr404(b.caseId);
      assertVisible(req.user, c);
      const { rows } = await query('SELECT d.* FROM documents d WHERE d.case_id=$1', [b.caseId]);
      docs = rows;
    } else {
      const { rows } = await query(
        `SELECT d.* FROM documents d JOIN cases c ON c.id=d.case_id
         WHERE ${req.user.role === 'LAWYER' ? 'c.lawyer_id=$1' : '1=1'}`,
        req.user.role === 'LAWYER' ? [req.user.id] : [],
      );
      docs = rows;
    }

    if (!docs.length) return res.json({ answer: 'Je n’ai trouvé aucun document accessible pour cette recherche.', sources: [] });

    const ids = docs.map((d) => d.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows: chunkRows } = await query(
      `SELECT dc.*, d.original_name, d.case_id, c.case_number, c.title
       FROM document_chunks dc
       JOIN documents d ON d.id=dc.document_id
       JOIN cases c ON c.id=d.case_id
       WHERE dc.document_id IN (${placeholders})`,
      ids,
    );

    if (!chunkRows.length) {
      return res.json({
        answer: 'Les documents sont bien enregistrés, mais aucun n’est encore préparé pour la recherche. Ajoutez un document ou attendez la fin de son analyse automatique.',
        sources: [],
      });
    }

    const questionVector = await embed(b.question);
    const ranked = chunkRows
      .map((x) => ({ ...x, score: cosine(questionVector, JSON.parse(x.embedding_json)) }))
      .sort((a, b2) => b2.score - a.score)
      .slice(0, 8);

    const context = ranked.map((x, i) =>
      `SOURCE ${i + 1}\nDocument: ${x.original_name}\nDossier: ${x.case_number} — ${x.title}\nExtrait:\n${x.content}`,
    ).join('\n\n');

    const system = `Tu es l’assistant documentaire du Cabinet Élite Juridique.
Réponds en français, clairement et prudemment.
Utilise UNIQUEMENT les informations du CONTEXTE fourni.
Si l’information n’est pas dans le contexte, dis explicitement que tu ne l’as pas trouvée.
Ne fabrique aucun fait, nom, date, montant ou article de loi.
Ne donne pas de conclusion juridique définitive : l’avocat reste responsable de l’analyse.
Cite les documents utilisés avec [Source 1], [Source 2], etc.

CONTEXTE :\n${context}`;

    const answer = await chat([
      { role: 'system', content: system },
      { role: 'user', content: b.question },
    ]);

    res.json({
      answer,
      sources: ranked.map((x, i) => ({
        number: i + 1,
        documentId: x.document_id,
        name: x.original_name,
        caseId: x.case_id,
        caseNumber: x.case_number,
        score: Number(x.score.toFixed(3)),
      })),
    });
  } catch (err) {
    next(err instanceof z.ZodError ? new HttpError(400, 'invalid_body', err.issues[0].message) : err);
  }
});

export { indexDocument, ollamaConfig };
export default router;
