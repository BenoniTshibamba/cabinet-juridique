import dotenv from 'dotenv';
dotenv.config();
import { createApp } from './app.js';
import { ensureDatabase, ensureDemoAdmin } from './db/bootstrap.js';

const port = Number(process.env.PORT) || 4000;

try {
  await ensureDatabase();
  await ensureDemoAdmin();
} catch (err) {
  console.error('ERREUR INITIALISATION BASE SQLITE:', err);
  process.exit(1);
}

const app = createApp();
const server = app.listen(port, () => {
  console.log(`Cabinet Élite Juridique — API sur http://localhost:${port}`);
  console.log(`API: http://localhost:${port}/api`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
