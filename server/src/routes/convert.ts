import { Router, type Request, type Response } from 'express';
import { dockerRunToCompose } from '../services/converter.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  try {
    const { command } = req.body;
    if (!command || typeof command !== 'string') {
      res.status(400).json({ error: 'command (string) is required' });
      return;
    }
    const compose = dockerRunToCompose(command);
    res.json({ compose });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
