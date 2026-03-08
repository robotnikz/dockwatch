import { Router, type Request, type Response } from 'express';
import {
  getCleanupDashboardSync,
  getCleanupPreview,
  isCleanupRunning,
  resetCleanupStatistics,
  runCleanup,
  saveCleanupConfig,
  type CleanupConfig,
} from '../services/cleanup.js';
import { restartCleanupScheduler } from '../services/cleanupScheduler.js';

const router = Router();

const CLEANUP_TOP_LEVEL_KEYS = new Set([
  'scheduleEnabled',
  'scheduleFrequency',
  'scheduleTime',
  'protectionEnabled',
  'protectedImageLabels',
  'protectedVolumeLabels',
  'options',
]);
const CLEANUP_OPTION_KEYS = new Set(['containers', 'images', 'networks', 'volumes', 'buildCache']);
const CLEANUP_LABEL_MAX_ITEMS = 100;
const CLEANUP_LABEL_MAX_LENGTH = 128;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateLabelList(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return `${field} must be an array`;
  if (value.length > CLEANUP_LABEL_MAX_ITEMS) return `${field} has too many entries`;
  for (const entry of value) {
    if (typeof entry !== 'string') return `${field} entries must be strings`;
    if (entry.length > CLEANUP_LABEL_MAX_LENGTH) return `${field} entry too long`;
  }
  return null;
}

function validateCleanupOptions(value: unknown): string | null {
  if (!isObjectRecord(value)) return 'options must be an object';
  for (const [key, val] of Object.entries(value)) {
    if (!CLEANUP_OPTION_KEYS.has(key)) return `Unknown options field: ${key}`;
    if (typeof val !== 'boolean') return `options.${key} must be a boolean`;
  }
  return null;
}

function validateCleanupConfigInput(value: unknown): string | null {
  if (!isObjectRecord(value)) return 'cleanup config must be an object';

  for (const [key, val] of Object.entries(value)) {
    if (!CLEANUP_TOP_LEVEL_KEYS.has(key)) return `Unknown cleanup config field: ${key}`;

    if ((key === 'scheduleEnabled' || key === 'protectionEnabled') && typeof val !== 'boolean') {
      return `${key} must be a boolean`;
    }

    if (key === 'scheduleFrequency' && val !== 'daily' && val !== 'weekly' && val !== 'monthly') {
      return 'scheduleFrequency must be one of: daily, weekly, monthly';
    }

    if (key === 'scheduleTime') {
      if (typeof val !== 'string') return 'scheduleTime must be a string';
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(val.trim())) return 'scheduleTime must match HH:mm';
    }

    if (key === 'protectedImageLabels' || key === 'protectedVolumeLabels') {
      const err = validateLabelList(val, key);
      if (err) return err;
    }

    if (key === 'options') {
      const err = validateCleanupOptions(val);
      if (err) return err;
    }
  }

  return null;
}

function validateCleanupRunInput(value: unknown): string | null {
  if (!isObjectRecord(value)) return 'cleanup run payload must be an object';
  for (const [key, val] of Object.entries(value)) {
    if (key === 'dryRun') {
      if (typeof val !== 'boolean') return 'dryRun must be a boolean';
      continue;
    }
    if (key === 'options') {
      const err = validateCleanupOptions(val);
      if (err) return err;
      continue;
    }
    return `Unknown cleanup run field: ${key}`;
  }
  return null;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const preview = await getCleanupPreview().catch(() => null);
    const dashboard = getCleanupDashboardSync(preview);
    res.json(dashboard);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config', (req: Request, res: Response) => {
  try {
    const error = validateCleanupConfigInput(req.body);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const body = req.body as Partial<CleanupConfig>;
    const config = saveCleanupConfig(body);
    restartCleanupScheduler();
    res.json({ ok: true, config });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/run', async (req: Request, res: Response) => {
  try {
    const error = validateCleanupRunInput(req.body);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const body = req.body as { options?: CleanupConfig['options']; dryRun?: boolean };
    const dryRun = req.query.dryRun === 'true' || body.dryRun === true;
    const savedConfig = saveCleanupConfig({ options: body.options });
    if (req.query.stream === 'true') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const result = await runCleanup('manual', savedConfig, {
        dryRun,
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        },
      });

      res.write(`data: ${JSON.stringify({ ok: true, result, finish: true })}\n\n`);
      res.end();
    } else {
      const result = await runCleanup('manual', savedConfig, { dryRun });
      res.json({ ok: true, result });
    }
  } catch (err: any) {
    if (req.query.stream === 'true') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.get('/preview', async (_req: Request, res: Response) => {
  try {
    const preview = await getCleanupPreview();
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset', (_req: Request, res: Response) => {
  try {
    if (isCleanupRunning()) {
      res.status(409).json({ error: 'Cannot reset statistics while cleanup is running' });
      return;
    }
    resetCleanupStatistics();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
