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
import { startScheduler } from './services/scheduler.js';
import { ensureStacksDir } from './services/docker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// API routes
app.use('/api/stacks', stacksRouter);
app.use('/api/updates', updatesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/convert', convertRouter);
app.use('/api/resources', resourcesRouter);

// Serve frontend in production
const webDist = path.resolve(__dirname, '../../web-dist');
app.use(express.static(webDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'));
});

async function main() {
  await ensureStacksDir();
  startScheduler();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🐳 DockWatch running on http://0.0.0.0:${PORT}`);
  });
}

main().catch(console.error);
