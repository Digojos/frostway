# syntax=docker/dockerfile:1

# ---- Build: type-check and bundle the client (and public/ sounds) into dist/ ----
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
RUN npm run build

# ---- Runtime: production dependencies + server source + built client ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=5180
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server imports the shared game code (src/sim, src/net...) from src/, so it ships alongside the build.
COPY --from=build /app/dist ./dist
COPY src ./src
COPY server ./server

USER node
EXPOSE 5180

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 5180) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "server/index.ts", "--prod"]
