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
import { validateCleanupConfigPayload, validateCleanupRunPayload } from '../validation/cleanup.js';
import { badRequest, conflict, internalServerError } from '../utils/httpResponses.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const preview = await getCleanupPreview().catch(() => null);
    const dashboard = getCleanupDashboardSync(preview);
    res.json(dashboard);
  } catch (err: any) {
    internalServerError(res, err);
  }
});

router.put('/config', (req: Request, res: Response) => {
  try {
    const validated = validateCleanupConfigPayload(req.body);
    if (!validated.ok) {
      badRequest(res, validated.error);
      return;
    }

    const config = saveCleanupConfig(validated.value as Partial<CleanupConfig>);
    restartCleanupScheduler();
    res.json({ ok: true, config });
  } catch (err: any) {
    badRequest(res, String(err?.message || 'Invalid cleanup config'));
  }
});

router.post('/run', async (req: Request, res: Response) => {
  try {
    const validated = validateCleanupRunPayload(req.body);
    if (!validated.ok) {
      badRequest(res, validated.error);
      return;
    }

    const body = validated.value as { options?: CleanupConfig['options']; dryRun?: boolean };
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
      internalServerError(res, err);
    }
  }
});

router.get('/preview', async (_req: Request, res: Response) => {
  try {
    const preview = await getCleanupPreview();
    res.json(preview);
  } catch (err: any) {
    internalServerError(res, err);
  }
});

router.post('/reset', (_req: Request, res: Response) => {
  try {
    if (isCleanupRunning()) {
      conflict(res, 'Cannot reset statistics while cleanup is running');
      return;
    }
    resetCleanupStatistics();
    res.json({ ok: true });
  } catch (err: any) {
    if (String(err?.message || '').toLowerCase().includes('running')) {
      conflict(res, 'Cannot reset statistics while cleanup is running');
      return;
    }
    internalServerError(res, err);
  }
});

export default router;
