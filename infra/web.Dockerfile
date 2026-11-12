# Builds the web app and serves it with Caddy. Build context: repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client-core/package.json packages/client-core/
COPY apps/web/package.json apps/web/
RUN npm ci -w @zirzircord/web -w @zirzircord/shared -w @zirzircord/client-core --include-workspace-root=false
COPY packages packages
COPY apps/web apps/web
RUN npm run build -w @zirzircord/web

FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
