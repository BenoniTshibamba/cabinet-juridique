import dotenv from 'dotenv';
dotenv.config();
import bcrypt from 'bcryptjs';
import { pool, query } from './pool.js';

const PASSWORD = 'Demo1234!';

async function upsertUser({ email, firstName, lastName, role }) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows: roleRows } = await query('SELECT id FROM roles WHERE name = $1', [role]);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO UPDATE SET first_name = $3, last_name = $4, role_id = $5
     RETURNING id`,
    [email, hash, firstName, lastName, roleRows[0].id],
  );
  return rows[0].id;
}

async function seed() {
  console.log('→ Génération des données de démonstration (mot de passe pour tous : Demo1234!)\n');

  const adminId = await upsertUser({ email: 'admin@cabinet-elite.example', firstName: 'Brandy', lastName: 'Ndaya', role: 'ADMIN' });
  const lawyer1 = await upsertUser({ email: 'j.dupont@cabinet-elite.example', firstName: 'Jean', lastName: 'Dupont', role: 'LAWYER' });
  const lawyer2 = await upsertUser({ email: 'm.leblanc@cabinet-elite.example', firstName: 'Marie', lastName: 'Leblanc', role: 'LAWYER' });
  await upsertUser({ email: 'a.tremblay@cabinet-elite.example', firstName: 'Alice', lastName: 'Tremblay', role: 'ASSISTANT' });
  await upsertUser({ email: 'p.gagnon@cabinet-elite.example', firstName: 'Paul', lastName: 'Gagnon', role: 'ASSISTANT' });
  await upsertUser({ email: 'c.roy@cabinet-elite.example', firstName: 'Claire', lastName: 'Roy', role: 'ACCOUNTANT' });
  const clients = [
    ['Marc', 'Lavoie', 'marc.lavoie@example.com', 'Lavoie Construction'],
    ['Isabelle', 'Côté', 'isabelle.cote@example.com', null],
    ['Groupe', 'Nordique', 'contact@groupenordique.example.com', 'Groupe Nordique Inc.'],
  ];
  const clientIds = [];
  for (const [firstName, lastName, email, company] of clients) {
    const { rows: existing } = await query('SELECT id FROM clients WHERE email = $1', [email]);
    if (existing[0]) {
      clientIds.push(existing[0].id);
      continue;
    }
    const { rows } = await query(
      `INSERT INTO clients (first_name, last_name, email, company, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [firstName, lastName, email, company, adminId],
    );
    clientIds.push(rows[0].id);
  }

  // Portail client : compte de connexion lié au profil client de Marc Lavoie (pour la démonstration).
  {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const { rows: roleRows } = await query("SELECT id FROM roles WHERE name = 'CLIENT'");
    await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role_id, client_id)
       VALUES ($1,$2,'Marc','Lavoie',$3,$4)
       ON CONFLICT (email) DO UPDATE SET role_id = $3, client_id = $4`,
      ['marc.lavoie@example.com', hash, roleRows[0].id, clientIds[0]],
    );
  }

  const caseDefs = [
    ['Litige commercial — Lavoie Construction', clientIds[0], lawyer1, 'Litige commercial', 'EN_COURS', 'HAUTE'],
    ['Divorce — Côté', clientIds[1], lawyer2, 'Droit familial', 'NOUVEAU', 'NORMALE'],
    ['Fusion Groupe Nordique', clientIds[2], lawyer1, 'Droit corporatif', 'EN_ATTENTE', 'HAUTE'],
    ['Bail commercial — Lavoie', clientIds[0], lawyer2, 'Droit immobilier', 'TERMINE', 'BASSE'],
    ['Contrat de travail — Nordique', clientIds[2], lawyer1, 'Droit du travail', 'EN_COURS', 'URGENTE'],
  ];
  const caseIds = [];
  for (const [title, clientId, lawyerId, caseType, status, priority] of caseDefs) {
    const caseNumber = `CEJ-2026-${1000 + caseIds.length}`;
    const { rows } = await query(
      `INSERT INTO cases (case_number, title, client_id, lawyer_id, case_type, status, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (case_number) DO UPDATE SET title = $2 RETURNING id`,
      [caseNumber, title, clientId, lawyerId, caseType, status, priority, adminId],
    );
    caseIds.push(rows[0].id);
  }

  const invoiceDefs = [
    [clientIds[0], caseIds[0], 250000, 37500, 'ENVOYEE'],
    [clientIds[1], caseIds[1], 80000, 12000, 'BROUILLON'],
    [clientIds[2], caseIds[2], 500000, 75000, 'PAYEE'],
    [clientIds[0], caseIds[3], 150000, 22500, 'PAYEE'],
    [clientIds[2], caseIds[4], 320000, 48000, 'EN_RETARD'],
  ];
  for (const [clientId, caseId, amount, tax, status] of invoiceDefs) {
    const invoiceNumber = `FAC-2026-${10000 + Math.floor(Math.random() * 8999)}`;
    await query(
      `INSERT INTO invoices (invoice_number, client_id, case_id, amount_cents, tax_cents, status, issued_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6, CURRENT_DATE, $7) ON CONFLICT (invoice_number) DO NOTHING`,
      [invoiceNumber, clientId, caseId, amount, tax, status, adminId],
    );
  }

  await query(
    `INSERT INTO case_notes (case_id, author_id, content)
     SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM case_notes WHERE case_id = $1 AND content = $3)`,
    [caseIds[0], lawyer1, "Premier entretien avec le client effectué. En attente des pièces comptables."],
  );

  await query(
    `INSERT INTO posts (author_id, title, content, type)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM posts WHERE title = $2)`,
    [lawyer1, 'Bienvenue au Cabinet Élite Juridique', 'Bienvenue dans l’espace de publications du cabinet. Les avocats et administrateurs peuvent partager des actualités, articles et informations utiles.', 'POST'],
  );
  await query(
    `INSERT INTO posts (author_id, title, content, type)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM posts WHERE title = $2)`,
    [adminId, 'Organisation des publications', 'Les publications permettent de partager les informations du cabinet. Seul leur auteur peut les modifier ou les supprimer.', 'ARTICLE'],
  );

  const notifTitle = 'Nouveau dossier assigné : ' + caseDefs[0][0];
  await query(
    `INSERT INTO notifications (user_id, type, title, related_case_id)
     SELECT $1, 'CASE_ASSIGNED', $2, $3 WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND title = $2)`,
    [lawyer1, notifTitle, caseIds[0]],
  );

  console.log('✔ Données de démonstration créées.');
  console.log('  Comptes (mot de passe : Demo1234!) :');
  console.log('  - admin@cabinet-elite.example        (ADMIN)');
  console.log('  - j.dupont@cabinet-elite.example      (LAWYER)');
  console.log('  - m.leblanc@cabinet-elite.example     (LAWYER)');
  console.log('  - a.tremblay@cabinet-elite.example    (ASSISTANT)');
  console.log('  - c.roy@cabinet-elite.example          (ACCOUNTANT)');
  console.log('  - marc.lavoie@example.com              (CLIENT — portail client)');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
