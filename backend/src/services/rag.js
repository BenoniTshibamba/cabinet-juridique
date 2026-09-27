import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { query } from '../db/pool.js';
import { HttpError } from '../middleware/auth.js';
import { embed } from './ollama.js';

export function chunks(text, size = 1400, overlap = 180) {
  const out = [];
  const step = Math.max(1, size - overlap);
  for (let i = 0; i < text.length; i += step) {
    const chunk = text.slice(i, i + size).trim();
    if (chunk) out.push(chunk);
  }
  return out;
}

export function cosine(a, b) {
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
}

export async function extractText(doc) {
  const ext = extname(doc.original_name).toLowerCase();
  const buf = await readFile(doc.storage_path);
  if (ext === '.txt') return buf.toString('utf8');
  if (ext === '.pdf') {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();
      await parser.destroy();
      return result.text || '';
    } catch {
      throw new HttpError(400, 'pdf_extract_failed', 'Impossible de lire ce PDF. Vérifiez que le fichier contient du texte sélectionnable.');
    }
  }
  if (ext === '.docx') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value || '';
    } catch {
      throw new HttpError(400, 'docx_extract_failed', 'Impossible de lire ce document Word.');
    }
  }
  throw new HttpError(400, 'unsupported_rag_file', 'Pour la recherche dans les documents, utilisez PDF, DOCX ou TXT.');
}

export async function indexDocument(doc) {
  const text = (await extractText(doc)).replace(/\s+/g, ' ').trim();
  if (!text) throw new HttpError(400, 'empty_document', 'Le document ne contient aucun texte exploitable.');

  const parts = chunks(text);
  await query('DELETE FROM document_chunks WHERE document_id=$1', [doc.id]);

  for (const part of parts) {
    const vector = await embed(part);
    await query(
      'INSERT INTO document_chunks(document_id,content,embedding_json) VALUES($1,$2,$3)',
      [doc.id, part, JSON.stringify(vector)],
    );
  }

  await query('UPDATE documents SET indexed_at=CURRENT_TIMESTAMP WHERE id=$1', [doc.id]);
  return { characters: text.length, chunks: parts.length };
}
