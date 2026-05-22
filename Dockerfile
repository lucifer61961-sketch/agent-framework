FROM node:20-alpine AS base
WORKDIR /app

# ── Install dependencies ───────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ── Build TypeScript ───────────────────────────────────────────────────────────
FROM base AS builder
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Production image ───────────────────────────────────────────────────────────
FROM base AS runner

# Install Docker CLI so the gateway can launch sandbox containers on the host
RUN apk add --no-cache docker-cli

# Non-root user
RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY directives/ ./directives/

# Create writable directories
RUN mkdir -p data workspace

EXPOSE 3000

ENV NODE_ENV=production \
    LOG_LEVEL=info

CMD ["node", "dist/start.js"]
