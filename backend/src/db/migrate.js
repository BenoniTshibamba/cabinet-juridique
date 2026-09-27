import { ensureDatabase } from './bootstrap.js';
import { close } from './pool.js';

try {
  await ensureDatabase();
  console.log('✔ Base SQLite créée, rôles et permissions synchronisés.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  close();
}
