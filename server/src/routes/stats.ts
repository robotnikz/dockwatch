import { Router, type Request, type Response } from 'express';
import { getAllContainerStats, getHostInfo } from '../services/stats.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [stats, host] = await Promise.all([getAllContainerStats(), getHostInfo()]);
    res.json({ host, containers: stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/containers', async (_req: Request, res: Response) => {
  try {
    const stats = await getAllContainerStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/host', async (_req: Request, res: Response) => {
  try {
    const host = await getHostInfo();
    res.json(host);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
