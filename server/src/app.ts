import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import stacksRouter from './routes/stacks.js';
import updatesRouter from './routes/updates.js';
import settingsRouter from './routes/settings.js';
import statsRouter from './routes/stats.js';
import convertRouter from './routes/convert.js';
import resourcesRouter from './routes/resources.js';
import metaRouter from './routes/meta.js';
import cleanupRouter from './routes/cleanup.js';
import authRouter from './routes/auth.js';
import { createApiRateLimit } from './middleware/apiRateLimit.js';
import { getAuthenticatedUsernameFromToken, getSessionTokenFromCookieHeader, isAuthEnabled } from './services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isLanOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const octets = host.split('.');
  if (octets.length === 4 && octets[0] === '172') {
    const second = Number(octets[1]);
    if (Number.isFinite(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

function createCorsOptions(): cors.CorsOptions {
  const allowAll = String(process.env.DOCKWATCH_CORS_ALLOW_ALL || '').trim().toLowerCase() === 'true';
  const configured = new Set(
    String(process.env.DOCKWATCH_CORS_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

  return {
    origin(origin, cb) {
      if (allowAll) {
        cb(null, true);
        return;
      }

      // Allow non-browser clients and same-origin server-to-server calls.
      if (!origin) {
        cb(null, true);
        return;
      }

      if (configured.has(origin)) {
        cb(null, true);
        return;
      }

      try {
        const parsed = new URL(origin);
        if (isLanOrLocalHost(parsed.hostname)) {
          cb(null, true);
          return;
        }
      } catch {
        // Fall through to explicit deny below.
      }

      cb(new Error('CORS origin denied'));
    },
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const apiRateLimit = createApiRateLimit({ windowMs: 60_000, maxRequests: 180 });
  const pageRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRateLimit);
  app.use('/api/auth', authRouter);

  app.use('/api', (req, res, next) => {
    if (!isAuthEnabled()) {
      next();
      return;
    }

    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const token = getSessionTokenFromCookieHeader(req.headers.cookie);
    if (!token) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
      return;
    }

    const username = getAuthenticatedUsernameFromToken(token);
    if (!username) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
      return;
    }

    (req as any).authUser = username;
    next();
  });

  // API routes
  app.use('/api/stacks', stacksRouter);
  app.use('/api/updates', updatesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/convert', convertRouter);
  app.use('/api/resources', resourcesRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/cleanup', cleanupRouter);

  // Keep a lightweight limiter for non-API fallback/static routes to reduce abuse.
  app.use(pageRateLimit);

  // Serve frontend in production
  const webDist = path.resolve(__dirname, '../../web-dist');
  app.use(express.static(webDist));
  app.get('*', pageRateLimit, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });

  return app;
}
