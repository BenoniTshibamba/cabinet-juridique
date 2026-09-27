import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, query } from './pool.js';
import { ROLES, PERMISSIONS, ROLE_PERMISSIONS } from '../utils/permissions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function ensureDatabase() {
  const schema = fs.readFileSync(path.join(HERE, 'schema.sql'), 'utf8');
  pool.exec(schema);
  try { pool.exec('ALTER TABLE documents ADD COLUMN indexed_at TEXT'); } catch (err) { if (!String(err?.message).includes('duplicate column name')) throw err; }
  try { pool.exec('ALTER TABLE posts ADD COLUMN image_filename TEXT'); } catch (err) { if (!String(err?.message).includes('duplicate column name')) throw err; }
  try { pool.exec('ALTER TABLE posts ADD COLUMN image_mime TEXT'); } catch (err) { if (!String(err?.message).includes('duplicate column name')) throw err; }
  for (const name of ROLES) await query('INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  for (const code of PERMISSIONS) await query('INSERT INTO permissions (code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [code]);
  const { rows: roleRows } = await query('SELECT id, name FROM roles');
  const { rows: permRows } = await query('SELECT id, code FROM permissions');
  const roleId = Object.fromEntries(roleRows.map(r => [r.name, r.id]));
  const permId = Object.fromEntries(permRows.map(r => [r.code, r.id]));
  await query('DELETE FROM role_permissions');
  for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
    for (const code of codes) await query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roleId[role], permId[code]]);
  }
}

export async function ensureDemoAdmin() {
  const email = 'admin@cabinet-elite.example';
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (rows[0]) {
    // Le compte de démonstration est toujours affiché sous le nom Brandy Ndaya,
    // même si une ancienne base contenait encore l'ancien nom.
    await query('UPDATE users SET first_name = $1, last_name = $2 WHERE id = $3', ['Brandy', 'Ndaya', rows[0].id]);
    return;
  }
  const { rows: roleRows } = await query('SELECT id FROM roles WHERE name = $1', ['ADMIN']);
  const hash = await bcrypt.hash('Demo1234!', 12);
  await query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role_id) VALUES ($1,$2,$3,$4,$5)`,
    [email, hash, 'Brandy', 'Ndaya', roleRows[0].id],
  );
  console.log('✓ Compte administrateur de démonstration créé: admin@cabinet-elite.example / Demo1234!');
}
