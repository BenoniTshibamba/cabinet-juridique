import express from 'express';
import cors from 'cors';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import clientRoutes from './routes/clients.js';
import caseRoutes from './routes/cases.js';
import documentRoutes from './routes/documents.js';
import invoiceRoutes from './routes/invoices.js';
import notificationRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import dashboardRoutes from './routes/dashboard.js';
import searchRoutes from './routes/search.js';
import socialRoutes, { POST_IMAGES_DIR } from './routes/social.js';
import aiRoutes from './routes/ai.js';
import registrationRoutes from './routes/registration.js';
import { HttpError } from './middleware/auth.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Autorise le frontend servi séparément en développement, tout en restant
  // compatible avec le frontend servi par Express sur :4000.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:4000,http://127.0.0.1:4000,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin non autorisée: ${origin}`));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '2mb' }));

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    next();
  });

  const api = express.Router();
  api.get('/health', (req, res) => res.json({ status: 'ok' }));
  api.use('/auth', authRoutes);
  api.use('/registration-requests', registrationRoutes);
  api.use('/users', userRoutes);
  api.use('/clients', clientRoutes);
  api.use('/cases', caseRoutes);
  api.use('/invoices', invoiceRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/audit-logs', auditRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/search', searchRoutes);
  api.use('/social', socialRoutes);
  api.use('/ai', aiRoutes);
  // Monté en dernier et sans préfixe (il expose /cases/:id/documents et /documents/:id/*) :
  // comme il est monté à la racine de l'API, son requireAuth interne s'appliquerait à TOUTE
  // requête qui l'atteint, y compris des routes publiques (ex. /social/public/posts) montées
  // après lui. En le montant en dernier, chaque route publique ou dédiée a déjà été gérée
  // par son propre routeur avant d'arriver ici.
  api.use('/', documentRoutes);
  api.use((req, res, next) => next(new HttpError(404, 'unknown_route', 'Route inconnue.')));
  app.use('/api', api);

  // Images des publications : lecture publique, comme le fil d'accueil lui-même.
  app.use('/uploads/post-images', express.static(POST_IMAGES_DIR));

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    // Les HttpError portent un message volontairement sûr à afficher (ex. « Ollama est
    // inaccessible… »), même quand leur statut est ≥ 500. Seules les erreurs inattendues
    // (bugs, exceptions non gérées) doivent être masquées par un message générique.
    const message = err instanceof HttpError ? err.message : 'Erreur interne du serveur.';
    res.status(status).json({
      error: { code: err.code ?? 'internal_error', message },
    });
  });

  return app;
}
