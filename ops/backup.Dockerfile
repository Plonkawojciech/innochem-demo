FROM node:22-bookworm-slim AS node
FROM postgres:17-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /backup-tool
COPY scripts/backup.mjs ./backup.mjs
ENTRYPOINT ["node","backup.mjs"]
