FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG NEXT_PUBLIC_GA4_MEASUREMENT_ID
ENV NEXT_PUBLIC_GA4_MEASUREMENT_ID=$NEXT_PUBLIC_GA4_MEASUREMENT_ID
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build
RUN ./node_modules/.bin/esbuild scripts/migrate.ts scripts/preflight.ts scripts/bootstrap-admin.ts scripts/invite-admin.ts scripts/report-legacy-delta.ts scripts/apply-legacy-catalog-delta.ts --bundle --platform=node --external:pg-native --format=esm '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' --out-extension:.js=.mjs --outdir=operations

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 1001 store && useradd --uid 1001 --gid store --no-create-home store
COPY --from=build --chown=store:store /app/.next/standalone ./
COPY --from=build --chown=store:store /app/.next/static ./.next/static
COPY --from=build --chown=store:store /app/public ./public
COPY --from=build --chown=store:store /app/operations ./operations
COPY --from=build --chown=store:store /app/db/migrations ./db/migrations
COPY --chown=store:store ops/worker.mjs ./operations/worker.mjs
COPY --chown=store:store ops/worker-once.mjs ./operations/worker-once.mjs
RUN mkdir -p /app/media && chown store:store /app/media
USER store
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.js"]
