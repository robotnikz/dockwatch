import { Router, type Request, type Response } from 'express';
import { getAppVersionStatus } from '../services/appVersion.js';
import { getSelfUpdateInfo, triggerSelfUpdate } from '../services/selfUpdate.js';

const router = Router();

router.get('/version', async (req: Request, res: Response) => {
  try {
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const status = await getAppVersionStatus(force);
    const selfUpdate = getSelfUpdateInfo();
    res.json({ ...status, selfUpdate });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get app version status' });
  }
});

router.post('/self-update', (_req: Request, res: Response) => {
  try {
    const result = triggerSelfUpdate();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to trigger self update' });
  }
});

export default router;
