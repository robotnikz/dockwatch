# ---- Build frontend ----
FROM node:22-alpine AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- Build server ----
FROM node:22-alpine AS server-build
WORKDIR /build/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build

# ---- Production ----
FROM node:22-alpine
RUN apk add --no-cache docker-cli docker-cli-compose

ARG APP_VERSION=dev
ARG APP_REVISION=unknown

WORKDIR /app

# Server dependencies (production only)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Compiled server
COPY --from=server-build /build/server/dist ./server/dist

# Built frontend
COPY --from=web-build /build/web-dist ./web-dist

# Data & stacks directories
RUN mkdir -p /app/data /opt/stacks

ENV PORT=3000
ENV DOCKWATCH_DATA=/app/data
ENV DOCKWATCH_STACKS=/opt/stacks
ENV NODE_ENV=production
ENV DOCKWATCH_VERSION=${APP_VERSION}
ENV DOCKWATCH_REVISION=${APP_REVISION}

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
