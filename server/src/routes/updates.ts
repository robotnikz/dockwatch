import { Router, type Request, type Response } from 'express';
import { checkAllUpdates, getCachedUpdates, checkImageUpdate } from '../services/updateChecker.js';

const router = Router();

// Get cached update status
router.get('/', (_req: Request, res: Response) => {
  try {
    const updates = getCachedUpdates();
    res.json(updates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger a full update check
router.post('/check', async (_req: Request, res: Response) => {
  try {
    const results = await checkAllUpdates();
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Check a specific image
router.post('/check/:image(*)', async (req: Request<{ image: string }>, res: Response) => {
  try {
    const result = await checkImageUpdate(req.params.image as string);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
