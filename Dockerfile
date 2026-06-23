# ---- Build frontend ----
FROM node:22-alpine AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Build server ----
FROM node:22-alpine AS server-build
WORKDIR /build/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci
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
RUN cd server && npm ci --omit=dev

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

# Liveness probe against the unauthenticated health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
