# Image unique : l'API Express sert aussi les fichiers statiques du frontend (voir docs/architecture.md).
FROM node:22-alpine
WORKDIR /app

COPY backend/package*.json backend/
RUN cd backend && npm install --omit=dev

COPY backend backend
COPY frontend frontend

WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
