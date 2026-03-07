import { Router, type Request, type Response } from 'express';
import { getAppVersionStatus } from '../services/appVersion.js';

const router = Router();

router.get('/version', async (req: Request, res: Response) => {
  try {
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const status = await getAppVersionStatus(force);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get app version status' });
  }
});

export default router;
