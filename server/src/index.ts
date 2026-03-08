import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import stacksRouter from './routes/stacks.js';
import updatesRouter from './routes/updates.js';
import settingsRouter from './routes/settings.js';
import statsRouter from './routes/stats.js';
import convertRouter from './routes/convert.js';
import resourcesRouter from './routes/resources.js';
import metaRouter from './routes/meta.js';
import { startScheduler } from './services/scheduler.js';
import cleanupRouter from './routes/cleanup.js';
import { startCleanupScheduler } from './services/cleanupScheduler.js';
import { ensureStacksDir } from './services/docker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 180;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();

function apiRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = requestBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  bucket.count += 1;
  next();
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRateLimit);

// API routes
app.use('/api/stacks', stacksRouter);
app.use('/api/updates', updatesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/convert', convertRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/meta', metaRouter);
app.use('/api/cleanup', cleanupRouter);

// Serve frontend in production
const webDist = path.resolve(__dirname, '../../web-dist');
app.use(express.static(webDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'));
});

async function main() {
  await ensureStacksDir();
  startScheduler();
  startCleanupScheduler();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🐳 DockWatch running on http://0.0.0.0:${PORT}`);
  });
}

main().catch(console.error);
