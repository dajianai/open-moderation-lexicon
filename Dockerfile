# syntax=docker/dockerfile:1

# --- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first so this layer caches independently of the sources.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data

# Compiles to dist/ and verifies that the lexicon artifact is present.
RUN npm run build

# Regenerate the OpenAPI document from the compiled schemas so the image never
# ships a stale one.
RUN npm run openapi:generate

# Drop dev dependencies from node_modules before copying it into the runtime image.
RUN npm prune --omit=dev

# --- Runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime

# dumb-init reaps zombies and forwards signals, so SIGTERM reaches Node and the
# graceful shutdown path in src/api/serve.ts actually runs.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# node:alpine already provides an unprivileged `node` user (uid 1000).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/data/generated ./data/generated
COPY --from=build --chown=node:node /app/data/overrides ./data/overrides
COPY --from=build --chown=node:node /app/openapi.json ./openapi.json
COPY --chown=node:node package.json UPSTREAM.lock.json LICENSE THIRD_PARTY_NOTICES.md ./

USER node

EXPOSE 3000

# The lexicon takes ~100 ms to load, so start-period covers cold start without
# masking a genuinely broken deployment.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/api/serve.js"]
