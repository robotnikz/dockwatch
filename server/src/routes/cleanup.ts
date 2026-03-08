import { Router, type Request, type Response } from 'express';
import {
  getCleanupDashboardSync,
  getCleanupPreview,
  runCleanup,
  saveCleanupConfig,
  type CleanupConfig,
} from '../services/cleanup.js';
import { restartCleanupScheduler } from '../services/cleanupScheduler.js';

const router = Router();

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

export default router;
