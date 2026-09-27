// Source unique de vérité pour les rôles et permissions (RBAC).
// Toute vérification d'autorisation, côté backend, part de ce fichier.

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'LAWYER', 'ASSISTANT', 'ACCOUNTANT', 'CLIENT'];

export const PERMISSIONS = [
  'users.read', 'users.create', 'users.update', 'users.delete',
  'clients.read', 'clients.create', 'clients.update', 'clients.delete',
  'cases.read', 'cases.create', 'cases.update', 'cases.delete',
  'documents.read', 'documents.upload', 'documents.delete',
  'billing.read', 'billing.create', 'billing.update',
  'audit.read',
  'dashboard.read',
  'posts.read', 'posts.create', 'posts.interact', 'posts.update_own', 'posts.delete_own',
  'messages.read', 'messages.send',
  'ai.ask', 'ai.manage',
];

const ALL = PERMISSIONS;

/** Permissions accordées à chaque rôle. SUPER_ADMIN et ADMIN ont un accès complet. */
export const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ALL,
  ADMIN: ALL,
  LAWYER: [
    'posts.read','posts.create','posts.interact','posts.update_own','posts.delete_own',
    'messages.read','messages.send','ai.ask','ai.manage',
    'clients.read', 'clients.create', 'clients.update',
    'cases.read', 'cases.create', 'cases.update',
    'documents.read', 'documents.upload', 'documents.delete',
    'billing.read',
    'dashboard.read',
  ],
  ASSISTANT: [
    'posts.read','posts.interact','messages.read','messages.send','ai.ask',
    'clients.read', 'clients.create', 'clients.update',
    'cases.read', 'cases.update',
    'documents.read', 'documents.upload',
    'dashboard.read',
  ],
  ACCOUNTANT: [
    'posts.read','posts.interact','messages.read','messages.send',
    'clients.read', 'cases.read',
    'billing.read', 'billing.create', 'billing.update',
    'dashboard.read',
  ],
  CLIENT: [
    'posts.read','posts.interact','messages.read','messages.send','ai.ask',
    'cases.read', 'documents.read', 'billing.read', 'dashboard.read',
  ],
};

/**
 * Rôles dont la visibilité sur les dossiers/documents/factures est restreinte à leurs propres données
 * (LAWYER : dossiers dont il est responsable ; CLIENT : dossiers de son propre profil client).
 * ADMIN, SUPER_ADMIN, ASSISTANT et ACCOUNTANT voient l'ensemble du cabinet.
 */
export const SCOPED_ROLES = new Set(['LAWYER', 'CLIENT']);
