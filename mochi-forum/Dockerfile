FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

WORKDIR /app/server
CMD ["sh", "-c", "node scripts/migrate.js && node scripts/seed.js && node src/index.js"]