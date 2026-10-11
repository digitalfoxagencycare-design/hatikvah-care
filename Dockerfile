# HaTikvah Care: website + admin + API in one small image (Cloud Run friendly).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
RUN npm run build -w apps/web

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w apps/api --no-audit --no-fund && npm cache clean --force
COPY apps/api/src apps/api/src
COPY data data
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /app/.data /tmp/data && chown -R node:node /app/.data /tmp/data
USER node
EXPOSE 8080
# Secrets (JWT_SECRET, MONGODB_URI) come from the environment at run time; the server refuses to start in production without them.
CMD ["node", "apps/api/src/server.js"]
