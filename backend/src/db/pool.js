import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

// SQLite remplace PostgreSQL : aucune installation de serveur de base de données n'est nécessaire.
const dbPath = resolve(process.env.SQLITE_DB_PATH ?? './data/cabinet-elite.db');
if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });

export const pool = new DatabaseSync(dbPath);
pool.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

function sqliteSql(text) {
  return String(text)
    .replace(/\$([0-9]+)/g, '@p$1')
    .replace(/\bnow\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/::(?:int|integer|bigint)\b/gi, '')
    .replace(/\btrue\b/gi, '1')
    .replace(/\bfalse\b/gi, '0')
    .replace(/\bCURRENT_DATE\b/gi, 'CURRENT_DATE');
}

function bindParams(params = []) {
  const values = Array.isArray(params) ? params : [];
  return Object.fromEntries(values.map((value, index) => [`p${index + 1}`, normalize(value)]));
}

function normalize(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

function resultFor(statement, params) {
  const sql = sqliteSql(statement).trim();
  const bound = bindParams(params);
  const prepared = pool.prepare(sql);
  const upper = sql.toUpperCase();

  try {
    if (/^(SELECT|PRAGMA|WITH)\b/.test(upper) || /\bRETURNING\b/.test(upper)) {
      return { rows: prepared.all(bound), rowCount: 0 };
    }

    const result = prepared.run(bound);
    return { rows: [], rowCount: Number(result.changes ?? 0), lastInsertRowid: result.lastInsertRowid };
  } catch (err) {
    // Conserver les codes PostgreSQL attendus par les routes existantes.
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') err.code = '23505';
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') err.code = '23503';
    if (err?.code === 'SQLITE_CONSTRAINT_CHECK') err.code = '23514';
    throw err;
  }
}

export const query = async (text, params = []) => resultFor(text, params);

/** Compatibilité avec l'ancienne API : transactions SQLite locales. */
export async function withTransaction(fn) {
  pool.exec('BEGIN');
  try {
    const client = { query };
    const result = await fn(client);
    pool.exec('COMMIT');
    return result;
  } catch (err) {
    pool.exec('ROLLBACK');
    throw err;
  }
}

export function close() {
  pool.close();
}

// Compatibilité avec l'ancienne API pg utilisée par certains scripts/tests.
pool.end = async () => close();
