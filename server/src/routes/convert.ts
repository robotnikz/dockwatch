import { Router, type Request, type Response } from 'express';
import { dockerRunToCompose } from '../services/converter.js';

const router = Router();
const MAX_COMMAND_LENGTH = 8192;

router.post('/', (req: Request, res: Response) => {
  try {
    const { command } = req.body;
    if (!command || typeof command !== 'string') {
      res.status(400).json({ error: 'command (string) is required' });
      return;
    }
    const normalized = command.trim();
    if (normalized.length === 0) {
      res.status(400).json({ error: 'command must not be empty' });
      return;
    }
    if (normalized.length > MAX_COMMAND_LENGTH) {
      res.status(400).json({ error: 'command too long' });
      return;
    }
    const compose = dockerRunToCompose(normalized);
    res.json({ compose });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
