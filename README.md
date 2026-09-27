# Cabinet Élite Juridique

Plateforme web de gestion pour cabinet d'avocats : clients, dossiers juridiques, documents,
facturation, notifications et journal d'audit — avec authentification, rôles et permissions.

> **Note sur le périmètre.** Ce projet part d'un cahier des charges qui envisageait une
> architecture microservices complète avec assistant IA (RAG). Le résultat livré ici est un
> monolithe modulaire complet et testé, sans RAG. Les raisons de chaque écart, assumées et
> expliquées en détail, sont dans [docs/architecture.md](docs/architecture.md) — à lire avant
> de juger le choix d'architecture.

## Fonctionnalités

- **Authentification** JWT (access + refresh token avec rotation) et 6 rôles : Super
  administrateur, Administrateur, Avocat, Assistant, Comptable, Client.
- **RBAC** vérifié côté serveur : chaque route exige une permission précise ; un avocat ne
  voit que ses dossiers assignés, un client ne voit que les siens.
- **Clients** : fiches, recherche, historique des dossiers et factures.
- **Dossiers juridiques** : statuts, priorités, notes, avocat responsable, numérotation
  automatique.
- **Documents** : téléversement, téléchargement, suppression, versionnement simple,
  restrictions de type et de taille de fichier.
- **Facturation** : création, changement de statut, génération de PDF.
- **Notifications** in-app et **journal d'audit** complet (qui a fait quoi, quand, depuis
  quelle IP).
- **Tableau de bord** et **recherche globale** (clients, dossiers, documents).
- Interface **responsive**, **thème clair/sombre**, sans framework frontend ni étape de build.

## Démarrage rapide (sans Docker)

Prérequis : [Node.js](https://nodejs.org) ≥ 22.5. La base de données est SQLite et ne nécessite aucun serveur PostgreSQL.

```bash
# 1. Installer le backend
cd backend
npm install

# 2. Créer la base SQLite et charger les données de démonstration
npm run migrate
npm run seed

# 3. Démarrer
npm start
```

L'application est servie sur <http://localhost:4000> (frontend et API sur le même port).

### Frontend servi séparément

Le frontend utilise désormais directement `http://localhost:4000/api` par défaut. Vous pouvez
donc aussi ouvrir `frontend/index.html` avec un serveur statique (par exemple Live Server sur
`:5500`) : les requêtes `/api/...` sont envoyées au backend `:4000`. Les origines de
développement autorisées sont configurables avec `CORS_ORIGINS` dans `backend/.env`.

### Comptes de démonstration

Créés par `npm run seed`, mot de passe identique pour tous : **`Demo1234!`**

| Rôle | Courriel |
|---|---|
| Administrateur | admin@cabinet-elite.example |
| Avocat | j.dupont@cabinet-elite.example |
| Avocat | m.leblanc@cabinet-elite.example |
| Assistant | a.tremblay@cabinet-elite.example |
| Comptable | c.roy@cabinet-elite.example |
| Client (portail) | marc.lavoie@example.com |

## Avec Docker

```bash
docker compose up --build
```

Le conteneur utilise également SQLite. Les données SQLite et les fichiers téléversés sont
persistés dans des volumes Docker.

## Tests

```bash
cd backend
npm test
```

Les tests (`node:test`) utilisent la base SQLite locale : authentification, rotation des
jetons, RBAC (permissions refusées, visibilité par rôle), CRUD clients/dossiers, upload et
restriction de type de fichier, facturation et génération de PDF, journal d'audit, tableau
de bord, recherche.

## Structure du projet

```
backend/
  src/
    app.js            Application Express (routes + fichiers statiques)
    server.js          Point d'entrée
    db/
      schema.sql        Schéma SQLite
      migrate.js         Applique le schéma, synchronise rôles/permissions
      seed.js            Données de démonstration
      pool.js            Accès SQLite
    middleware/
      auth.js            JWT + vérification des permissions (RBAC)
    routes/              Une route Express par domaine métier
    services/
      audit.js           Journal d'audit
      notify.js          Notifications in-app
    utils/
      permissions.js     Source unique de vérité des rôles/permissions
  test/
    api.test.js          Suite de tests (node:test)
  uploads/               Fichiers téléversés (créé au runtime)
frontend/
  index.html
  css/styles.css         Système de design (thème clair/sombre inclus)
  js/                    Application (routage par hash, aucun framework)
docs/
  architecture.md        Décisions techniques, limites, feuille de route
docker-compose.yml       Déploiement Docker avec SQLite
Dockerfile
```

## API

Toutes les routes sont préfixées par `/api` et répondent en JSON.
Voir le code des routes (`backend/src/routes/`) pour le détail des paramètres ; aperçu :

| Domaine | Routes principales |
|---|---|
| Auth | `POST /api/auth/login`, `/refresh`, `/logout`, `GET /me`, `POST /change-password` |
| Utilisateurs | `GET/POST /api/users`, `PATCH /api/users/:id` |
| Clients | `GET/POST /api/clients`, `GET/PATCH/DELETE /api/clients/:id` |
| Dossiers | `GET/POST /api/cases`, `GET/PATCH/DELETE /api/cases/:id`, `/:id/notes` |
| Documents | `GET/POST /api/cases/:caseId/documents`, `GET /api/documents/:id/download` |
| Facturation | `GET/POST /api/invoices`, `PATCH /api/invoices/:id/status`, `GET /:id/pdf` |
| Notifications | `GET /api/notifications`, `/unread-count`, `POST /:id/read` |
| Audit | `GET /api/audit-logs` (réservé aux permissions `audit.read`) |
| Tableau de bord | `GET /api/dashboard` |
| Recherche | `GET /api/search?q=...` |

## Sécurité

- Mots de passe hachés avec bcrypt (jamais stockés en clair).
- JWT à courte durée de vie (15 min) + refresh token avec rotation et révocation.
- RBAC vérifié côté serveur uniquement (jamais confiance au frontend seul).
- Upload : extensions autorisées en liste blanche, taille limitée (25 Mo), noms de fichiers
  générés aléatoirement sur le disque (jamais le nom fourni par le client).
- En-têtes `X-Content-Type-Options`, `Referrer-Policy`.
- Secrets dans `.env` (jamais commités — voir `.gitignore`).

Voir [docs/architecture.md](docs/architecture.md) pour les limites connues et ce qui reste
à durcir avant un déploiement en production réelle.

## Licence

MIT pour le code. Aucune donnée réelle de client ou de cabinet n'est utilisée : toutes les
données de démonstration sont fictives.

## SQLite / démarrage simplifié

Cette version ne nécessite pas PostgreSQL. Le serveur initialise automatiquement la base SQLite au démarrage et crée le compte de démonstration si nécessaire.

```powershell
cd backend
npm install
npm start
```

Puis ouvrir `http://localhost:4000`.

Compte démo : `admin@cabinet-elite.example` / `Demo1234!`.

La base est dans `backend/data/cabinet-elite.db`. Pour repartir d'une installation de démonstration propre, arrêter le serveur, supprimer ce fichier, puis relancer `npm start`.

## Nouvelles fonctionnalités — AI, RAG, publications et messagerie

Cette version ajoute :
- Assistant AI accessible depuis « Assistant AI ».
- Recherche dans les documents autorisés d’un dossier avant génération de la réponse.
- Indexation des PDF/DOCX/TXT avec embeddings OpenAI et stockage local des vecteurs dans SQLite.
- Publications et articles avec likes, commentaires et partage par message.
- Règle serveur : seul l’auteur peut modifier ou supprimer sa publication.
- Messagerie directe entre utilisateurs actifs.
- Demande d’accès depuis l’écran de connexion (approbation administrative à prévoir).

### Configuration AI

Dans `backend/.env`, ajouter `OPENAI_API_KEY`. Puis, depuis `backend/` :

```bash
npm install
npm start
```

Les dépendances `pdf-parse` et `mammoth` sont nécessaires pour l’indexation PDF/DOCX. Les documents doivent être indexés depuis le dossier avant d’être interrogés par l’assistant.


## Accueil public

À l'ouverture de `http://localhost:4000`, l'application affiche maintenant un **accueil public** sans demander de mot de passe.

Les visiteurs peuvent :
- voir les publications et articles publics du cabinet;
- voir les auteurs, dates, likes et commentaires;
- se connecter via **Se connecter**;
- envoyer une **demande d'accès** via **Demander un accès**.

Les actions privées (liker, commenter, messagerie, dossiers, documents et assistant AI) restent protégées par authentification.

Après connexion, l'utilisateur retrouve l'application complète. Une déconnexion renvoie également vers l'accueil public.

## Assistant AI local avec Ollama

Le projet utilise maintenant Ollama localement : aucune clé OpenAI n'est nécessaire.

1. Installer Ollama : https://ollama.com/download
2. Démarrer Ollama.
3. Dans PowerShell :

```powershell
ollama pull llama3:latest
ollama pull nomic-embed-text
```

4. Vérifier :

```powershell
ollama list
```

5. Lancer le cabinet :

```powershell
cd backend
npm install
npm run migrate
npm run seed
npm start
```

Ouvrir ensuite `http://localhost:4000`.

### Documents et RAG

Dans un dossier : **Dossiers → choisir le dossier → Documents → Ajouter un document**.

L'analyse RAG démarre automatiquement après l'envoi pour les PDF, DOCX et TXT. Si Ollama n'est pas lancé, le document reste enregistré et le bouton **Analyser maintenant** permet de relancer l'analyse après avoir démarré Ollama.

### Publications

Les **Administrateurs** et **Avocats** disposent du bouton **Publier** dans **Accueil**. Ils peuvent créer des publications ou articles. Seul l'auteur peut modifier ou supprimer sa propre publication. Les autres utilisateurs autorisés peuvent aimer, commenter et envoyer une publication par message.

### Dépannage rapide

- `Ollama est inaccessible` : démarrer Ollama.
- `modèle manque` : exécuter `ollama pull llama3:latest` et `ollama pull nomic-embed-text`.
- Une publication n'apparaît pas : ouvrir **Accueil** puis utiliser **Réessayer**. L'API affiche maintenant l'erreur au lieu de laisser une page vide.

## Si une ancienne session reste bloquée
Après une mise à jour majeure, si le navigateur conserve un ancien jeton, cliquez sur **Se déconnecter** ou, sur l'écran de connexion, ouvrez les outils du navigateur et supprimez la clé `cej:session` du stockage local. Une nouvelle connexion créera automatiquement une nouvelle session.
