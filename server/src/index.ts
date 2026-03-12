import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';
import { startCleanupScheduler } from './services/cleanupScheduler.js';
import { startStatusMonitor } from './services/statusMonitor.js';
import { ensureStacksDir } from './services/docker.js';
const PORT = parseInt(process.env.PORT || '3000', 10);
const app = createApp();

async function main() {
  await ensureStacksDir();

  if (fs.existsSync('/var/run/docker.sock')) {
    console.warn('[Security] Docker socket detected. DockWatch has host-level privileges via Docker API; keep access limited to trusted LAN/VPN.');
  }

  startScheduler();
  startCleanupScheduler();
  startStatusMonitor();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🐳 DockWatch running on http://0.0.0.0:${PORT}`);
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(console.error);
}
