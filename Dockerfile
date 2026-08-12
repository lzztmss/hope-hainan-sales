# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.17.0-bookworm-slim
ARG NGINX_IMAGE=nginx:1.28.0-alpine3.21
ARG POSTGRES_IMAGE=postgres:16.9-bookworm

FROM ${NODE_IMAGE} AS node-base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN npm install --global pnpm@11.9.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

FROM node-base AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm build

FROM node-base AS production-dependencies
RUN pnpm install --offline --frozen-lockfile --prod

FROM ${NODE_IMAGE} AS api
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Hainan FTTR Heartlink Sales API" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node package.json ./package.json
USER node
EXPOSE 3001
CMD ["node", "dist-server/server/index.js"]

FROM ${NGINX_IMAGE} AS web
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Hainan FTTR Heartlink Sales Web" \
      org.opencontainers.image.version="${APP_VERSION}"
COPY deploy/linux/config/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]

FROM ${POSTGRES_IMAGE} AS ops
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Hainan FTTR Heartlink Database Operations" \
      org.opencontainers.image.version="${APP_VERSION}"
USER root
COPY deploy/linux/scripts/container-backup.sh /opt/deploy/container-backup.sh
COPY deploy/linux/scripts/container-restore.sh /opt/deploy/container-restore.sh
RUN chmod 0755 /opt/deploy/container-backup.sh /opt/deploy/container-restore.sh
USER postgres
ENTRYPOINT ["/opt/deploy/container-backup.sh"]

FROM api AS final
