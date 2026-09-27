# Architecture — Cabinet Élite Juridique

Ce document explique les décisions techniques du projet, notamment les écarts assumés par
rapport à un cahier des charges initial qui envisageait une architecture microservices avec
RAG/IA complet. Chaque écart est justifié : rien n'a été simplifié silencieusement.

## Vue d'ensemble

```
Navigateur
   │
   ▼
Express (backend/src/app.js)
   ├── /api/*  → routes REST (JSON)
   └── /*      → fichiers statiques du frontend
   │
   ▼
SQLite (une base, un schéma)
```

Un seul processus Node.js sert à la fois l'API REST et les fichiers statiques du frontend
(HTML/CSS/JS sans framework, sans étape de build). Une seule base de données SQLite.

## Pourquoi un monolithe modulaire plutôt que des microservices

Le cahier des charges initial demandait 6 microservices indépendants (Auth, Dossier,
Document, Billing, Messaging, RAG) derrière une passerelle API, chacun avec sa propre
base de données, plus Redis et une base vectorielle.

Cette architecture a été délibérément remplacée par un **monolithe modulaire** : un seul
serveur Express, organisé en modules clairement séparés par domaine
(`routes/auth.js`, `routes/cases.js`, `routes/documents.js`, `routes/invoices.js`, etc.),
partageant une base SQLite unique.

Raisons :

1. **Cohérence transactionnelle.** Créer un dossier, l'assigner à un avocat et déclencher
   une notification sont des opérations liées. Dans un monolithe avec une seule base, ces
   opérations peuvent être transactionnelles. Réparties sur plusieurs services et bases,
   elles exigeraient une coordination distribuée (sagas, event bus) — une complexité que
   la taille de ce projet ne justifie pas.
2. **Coût opérationnel.** Six services indépendants signifient six déploiements, six
   surfaces de logs, six configurations réseau à sécuriser. Pour un cabinet de la taille
   décrite (quelques avocats, quelques centaines de dossiers), ce coût dépasse largement
   le bénéfice.
3. **La séparation par domaine est déjà là où elle compte.** Le découpage en modules
   (`routes/*.js`, permissions par domaine dans `utils/permissions.js`) donne la même
   lisibilité et le même isolement logique qu'un micro-service, sans le coût de
   déploiement séparé. Migrer un module vers un service à part entière plus tard, si le
   besoin apparaît réellement, resterait possible sans réécriture complète.

Le canal `/api/*` peut être placé, sans changement de code, derrière une passerelle Nginx
qui servirait aussi de point d'extension si un futur module devait effectivement devenir
un service séparé.

## Ce qui a été implémenté

- Authentification JWT (access + refresh token avec rotation), hachage bcrypt.
- RBAC (rôles → permissions) vérifié côté serveur sur chaque route, avec restriction de
  visibilité par ligne (un avocat ne voit que ses dossiers ; un client ne voit que les siens).
- Clients, dossiers, notes de dossier, documents (upload/téléchargement/suppression,
  versionnement simple par nom de fichier), facturation avec génération de PDF.
- Notifications in-app, journal d'audit (création/modification/suppression/connexion/téléchargement).
- Tableau de bord agrégé, recherche globale.
- Frontend responsive, thème clair/sombre, sans framework ni étape de build.
- 29 tests automatisés (`node:test`) contre une vraie base SQLite.

## Ce qui n'a pas été implémenté, et pourquoi

### RAG / assistant IA

Non implémenté. Deux raisons concrètes, pas seulement un choix de priorisation :

- Un RAG utile suppose un vrai modèle de langage. Cela nécessite une clé d'API externe
  (OpenAI, Anthropic, etc.) fournie et payée par le cabinet — elle n'existe pas dans ce
  projet de démonstration.
- L'environnement où ce projet a été développé n'a pas accès à Internet en dehors d'une
  liste de domaines autorisés (dépôts npm, PyPI, GitHub). Il n'a pas été possible d'y
  appeler un LLM ni d'y héberger une base vectorielle pour le tester réellement.

Le schéma de base de données (table `documents`) est compatible avec l'ajout ultérieur
d'une table `document_chunks` et d'embeddings, sans migration destructive.

### Messagerie interne

Non implémentée dans cette version. Les notifications in-app couvrent une partie du besoin
(alertes de dossier assigné, etc.). Une vraie messagerie (conversations, pièces jointes,
WebSocket) est un module supplémentaire raisonnable, non construit ici faute de temps.

### Microservices, Redis, base vectorielle

Voir la section précédente. Redis n'est pas utilisé : rien dans le périmètre implémenté
(pas de files d'attente, pas de cache distribué nécessaire à cette échelle) n'en avait besoin.

## Limites connues

- **`docker-compose.yml`** utilise maintenant un conteneur applicatif unique avec SQLite et
  deux volumes persistants (base de données et téléversements). Il doit être validé dans
  l'environnement Docker cible avant un déploiement de production.
- **Jetons en `localStorage`.** Par simplicité (pas de proxy à configurer pour ce projet de
  démonstration), l'access token et le refresh token sont stockés côté client en
  `localStorage`. En production, un cookie `httpOnly` signé serait préférable (protection
  contre le vol de jeton par script tiers).
- **Téléversement de fichiers en local.** Les documents sont stockés sur le disque du
  serveur (`backend/uploads/`), pas dans un stockage objet (S3 ou équivalent). Adapté à un
  déploiement mono-serveur ; à revoir avant une mise à l'échelle horizontale.
- **Versionnement des documents simplifié.** Un nouveau fichier portant le même nom dans un
  dossier incrémente la version ; il n'y a pas de diff ni de restauration d'une version
  antérieure.

## Feuille de route (si le projet devait continuer)

1. Messagerie interne (conversations liées à un dossier).
2. RAG : ingestion de documents, embeddings, recherche sémantique — nécessite une clé
   d'API LLM fournie par le cabinet.
3. Stockage des documents dans un service objet (S3-compatible) plutôt que sur disque.
4. Migration progressive vers des cookies `httpOnly` pour les jetons.
5. Tests de bout en bout du `docker-compose.yml` dans un environnement avec accès à Docker Hub.
