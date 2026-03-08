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
import cleanupRouter from './routes/cleanup.js';
import { createApiRateLimit } from './middleware/apiRateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  const apiRateLimit = createApiRateLimit({ windowMs: 60_000, maxRequests: 180 });
  const pageRateLimit = createApiRateLimit({ windowMs: 60_000, maxRequests: 600 });

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

  // Keep a lightweight limiter for non-API fallback/static routes to reduce abuse.
  app.use(pageRateLimit);

  // Serve frontend in production
  const webDist = path.resolve(__dirname, '../../web-dist');
  app.use(express.static(webDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });

  return app;
}
