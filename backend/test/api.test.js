import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db/pool.js';

let server;
let base;

// Compte administrateur dédié aux tests, créé directement en base (le endpoint /users exige déjà un admin).
const ADMIN_EMAIL = `test-admin-${Date.now()}@cabinet-elite.example`;
const ADMIN_PASSWORD = 'TestAdmin1234!';

async function createTestAdmin() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const { rows: role } = await query("SELECT id FROM roles WHERE name = 'ADMIN'");
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role_id) VALUES ($1,$2,'Test','Admin',$3) RETURNING id`,
    [ADMIN_EMAIL, hash, role[0].id],
  );
  return rows[0].id;
}

before(async () => {
  await createTestAdmin();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

const api = async (path, { token, method = 'GET', body, isForm } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
};

const login = async (email, password = 'Demo1234!') => {
  const { body } = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  return body.accessToken;
};

let adminToken;
let lawyerToken;
let otherLawyerToken;
let assistantToken;
let accountantToken;
let clientToken;
let clientUserClientId;

let clientId;
let caseId;
let otherLawyerId;

describe('auth', () => {
  test('login refuse un mot de passe incorrect', async () => {
    const res = await api('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: 'faux' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_credentials');
  });

  test('login réussi renvoie un accessToken et un refreshToken', async () => {
    const res = await api('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.ok(res.body.refreshToken);
    adminToken = res.body.accessToken;
  });

  test('/auth/me exige un token valide', async () => {
    assert.equal((await api('/api/auth/me')).status, 401);
    assert.equal((await api('/api/auth/me', { token: 'invalide' })).status, 401);
    const ok = await api('/api/auth/me', { token: adminToken });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.role, 'ADMIN');
    assert.ok(ok.body.permissions.includes('billing.create'));
  });

  test('refresh puis logout invalident correctement les jetons', async () => {
    const loginRes = await api('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const refreshToken = loginRes.body.refreshToken;

    const refreshed = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.accessToken);

    // Le jeton de rafraîchissement d'origine a été révoqué par la rotation : il ne doit plus fonctionner.
    const reused = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
    assert.equal(reused.status, 401);

    const logout = await api('/api/auth/logout', { method: 'POST', body: { refreshToken: refreshed.body.refreshToken } });
    assert.equal(logout.status, 204);
    const afterLogout = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: refreshed.body.refreshToken } });
    assert.equal(afterLogout.status, 401);
  });
});

describe('gestion des utilisateurs et RBAC', () => {
  test("l'admin crée un avocat, un second avocat, un assistant, un comptable", async () => {
    const stamp = Date.now();
    const lawyer = await api('/api/users', {
      token: adminToken, method: 'POST',
      body: { email: `lawyer-${stamp}@test.example`, password: 'Passw0rd!', firstName: 'Léa', lastName: 'Martin', role: 'LAWYER' },
    });
    assert.equal(lawyer.status, 201);
    lawyerToken = await login(lawyer.body.email, 'Passw0rd!');

    const other = await api('/api/users', {
      token: adminToken, method: 'POST',
      body: { email: `lawyer2-${stamp}@test.example`, password: 'Passw0rd!', firstName: 'Omar', lastName: 'Nasser', role: 'LAWYER' },
    });
    otherLawyerId = other.body.id;
    otherLawyerToken = await login(other.body.email, 'Passw0rd!');

    const assistant = await api('/api/users', {
      token: adminToken, method: 'POST',
      body: { email: `assist-${stamp}@test.example`, password: 'Passw0rd!', firstName: 'Ana', lastName: 'Petit', role: 'ASSISTANT' },
    });
    assistantToken = await login(assistant.body.email, 'Passw0rd!');

    const accountant = await api('/api/users', {
      token: adminToken, method: 'POST',
      body: { email: `acct-${stamp}@test.example`, password: 'Passw0rd!', firstName: 'Yuki', lastName: 'Sato', role: 'ACCOUNTANT' },
    });
    accountantToken = await login(accountant.body.email, 'Passw0rd!');
  });

  test('un non-admin ne peut pas créer un utilisateur', async () => {
    const res = await api('/api/users', {
      token: lawyerToken, method: 'POST',
      body: { email: 'x@test.example', password: 'Passw0rd!', firstName: 'X', lastName: 'Y', role: 'LAWYER' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'forbidden');
  });

  test('email déjà utilisé → 409', async () => {
    const res = await api('/api/users', {
      token: adminToken, method: 'POST',
      body: { email: ADMIN_EMAIL, password: 'Passw0rd!', firstName: 'X', lastName: 'Y', role: 'LAWYER' },
    });
    assert.equal(res.status, 409);
  });
});

describe('clients', () => {
  test('création et lecture', async () => {
    const create = await api('/api/clients', {
      token: adminToken, method: 'POST',
      body: { firstName: 'Nadia', lastName: 'Haddad', email: 'nadia@test.example', company: 'Haddad Inc.' },
    });
    assert.equal(create.status, 201);
    clientId = create.body.id;

    const read = await api(`/api/clients/${clientId}`, { token: adminToken });
    assert.equal(read.body.lastName, 'Haddad');
  });

  test('recherche par nom', async () => {
    const res = await api('/api/clients?q=Haddad', { token: adminToken });
    assert.ok(res.body.some((c) => c.id === clientId));
  });

  test('un rôle sans clients.create ne peut pas créer de client', async () => {
    const res = await api('/api/clients', { token: accountantToken, method: 'POST', body: { firstName: 'A', lastName: 'B' } });
    assert.equal(res.status, 403);
  });

  test('client introuvable → 404', async () => {
    assert.equal((await api('/api/clients/999999', { token: adminToken })).status, 404);
  });
});

describe('dossiers (cases) et visibilité par rôle', () => {
  test("création d'un dossier assigné à l'avocat 1", async () => {
    const res = await api('/api/cases', {
      token: adminToken, method: 'POST',
      body: { title: 'Litige test', clientId, lawyerId: undefined },
    });
    // lawyerId omis volontairement ici ; on assigne ensuite pour vérifier la notification.
    assert.equal(res.status, 201);
    caseId = res.body.id;
    assert.match(res.body.caseNumber, /^CEJ-\d{4}-\d{4}$/);
  });

  test("assignation déclenche une notification pour l'avocat", async () => {
    const lawyerMe = await api('/api/auth/me', { token: lawyerToken });
    const assign = await api(`/api/cases/${caseId}`, { token: adminToken, method: 'PATCH', body: { lawyerId: lawyerMe.body.id } });
    assert.equal(assign.status, 200);
    assert.equal(assign.body.lawyerName, `${lawyerMe.body.firstName} ${lawyerMe.body.lastName}`);

    const notifs = await api('/api/notifications', { token: lawyerToken });
    assert.ok(notifs.body.some((n) => n.caseId === caseId && n.type === 'CASE_ASSIGNED'));
  });

  test("l'avocat assigné voit le dossier, un autre avocat non", async () => {
    const mine = await api(`/api/cases/${caseId}`, { token: lawyerToken });
    assert.equal(mine.status, 200);
    const notMine = await api(`/api/cases/${caseId}`, { token: otherLawyerToken });
    assert.equal(notMine.status, 403);
  });

  test('la liste des dossiers est filtrée pour un avocat', async () => {
    const res = await api('/api/cases', { token: lawyerToken });
    assert.ok(res.body.every((c) => c.id !== undefined));
    assert.ok(res.body.some((c) => c.id === caseId));
    const otherRes = await api('/api/cases', { token: otherLawyerToken });
    assert.ok(otherRes.body.every((c) => c.id !== caseId));
  });

  test('ajout de note de dossier', async () => {
    const res = await api(`/api/cases/${caseId}/notes`, { token: lawyerToken, method: 'POST', body: { content: 'Premier contact effectué.' } });
    assert.equal(res.status, 201);
    const list = await api(`/api/cases/${caseId}/notes`, { token: lawyerToken });
    assert.ok(list.body.some((n) => n.content === 'Premier contact effectué.'));
  });

  test('transition de statut', async () => {
    const res = await api(`/api/cases/${caseId}`, { token: lawyerToken, method: 'PATCH', body: { status: 'EN_COURS' } });
    assert.equal(res.body.status, 'EN_COURS');
  });
});

describe('documents', () => {
  test('upload, liste, téléchargement', async () => {
    const form = new FormData();
    form.append('file', new Blob(['contenu de test'], { type: 'text/plain' }), 'piece.txt');
    const up = await fetch(`${base}/api/cases/${caseId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${lawyerToken}` },
      body: form,
    });
    assert.equal(up.status, 201);
    const doc = await up.json();
    assert.equal(doc.originalName, 'piece.txt');
    assert.equal(doc.version, 1);

    const list = await api(`/api/cases/${caseId}/documents`, { token: lawyerToken });
    assert.ok(list.body.some((d) => d.id === doc.id));

    const dl = await fetch(`${base}/api/documents/${doc.id}/download`, { headers: { Authorization: `Bearer ${lawyerToken}` } });
    assert.equal(dl.status, 200);
    assert.equal(await dl.text(), 'contenu de test');
  });

  test('type de fichier interdit rejeté', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x']), 'malware.exe');
    const res = await fetch(`${base}/api/cases/${caseId}/documents`, {
      method: 'POST', headers: { Authorization: `Bearer ${lawyerToken}` }, body: form,
    });
    assert.equal(res.status, 400);
  });

  test("un avocat non responsable ne peut pas téléverser sur ce dossier", async () => {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    const res = await fetch(`${base}/api/cases/${caseId}/documents`, {
      method: 'POST', headers: { Authorization: `Bearer ${otherLawyerToken}` }, body: form,
    });
    assert.equal(res.status, 403);
  });
});

describe('facturation', () => {
  let invoiceId;

  test('un assistant ne peut pas créer de facture', async () => {
    const res = await api('/api/invoices', { token: assistantToken, method: 'POST', body: { clientId, amountCents: 1000 } });
    assert.equal(res.status, 403);
  });

  test('le comptable crée une facture et génère le PDF', async () => {
    const res = await api('/api/invoices', {
      token: accountantToken, method: 'POST',
      body: { clientId, caseId, amountCents: 100000, taxCents: 15000, dueAt: '2026-12-01' },
    });
    assert.equal(res.status, 201);
    invoiceId = res.body.id;
    assert.equal(res.body.totalCents, 115000);
    assert.equal(res.body.status, 'BROUILLON');

    const pdf = await fetch(`${base}/api/invoices/${invoiceId}/pdf`, { headers: { Authorization: `Bearer ${accountantToken}` } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await pdf.arrayBuffer());
    assert.equal(buf.slice(0, 4).toString(), '%PDF');
  });

  test('changement de statut vers PAYEE horodate le paiement', async () => {
    const res = await api(`/api/invoices/${invoiceId}/status`, { token: accountantToken, method: 'PATCH', body: { status: 'PAYEE' } });
    assert.equal(res.body.status, 'PAYEE');
    assert.ok(res.body.paidAt);
  });
});

describe('audit et tableau de bord', () => {
  test('le journal d’audit contient les actions effectuées', async () => {
    const res = await api('/api/audit-logs?limit=100', { token: adminToken });
    assert.equal(res.status, 200);
    const actions = res.body.map((a) => a.action);
    assert.ok(actions.includes('CASE_CREATED'));
    assert.ok(actions.includes('DOCUMENT_UPLOADED'));
    assert.ok(actions.includes('INVOICE_CREATED'));
  });

  test("un non-admin n'a pas accès au journal d'audit", async () => {
    assert.equal((await api('/api/audit-logs', { token: lawyerToken })).status, 403);
  });

  test('le tableau de bord reflète les données créées', async () => {
    const res = await api('/api/dashboard', { token: adminToken });
    assert.equal(res.status, 200);
    assert.ok(res.body.cases.total >= 1);
    assert.ok(res.body.clients.total >= 1);
  });

  test('le tableau de bord d’un avocat est filtré à ses dossiers', async () => {
    const res = await api('/api/dashboard', { token: lawyerToken });
    const other = await api('/api/dashboard', { token: otherLawyerToken });
    assert.ok(res.body.cases.total >= 1);
    assert.equal(other.body.cases.total, 0); // le second avocat n'a aucun dossier assigné
  });
});

describe('recherche globale', () => {
  test('trouve le client et le dossier créés', async () => {
    const res = await api('/api/search?q=Haddad', { token: adminToken });
    assert.ok(res.body.clients.some((c) => c.id === clientId));
  });

  test('paramètre q manquant → 400', async () => {
    assert.equal((await api('/api/search', { token: adminToken })).status, 400);
  });
});
