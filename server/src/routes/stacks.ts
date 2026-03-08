import { Router, type Response } from 'express';
import type { Request } from 'express';
import {
  listStacks,
  getComposeContent,
  saveComposeContent,
  deleteStack,
  composeUp,
  composeDown,
  composeRestart,
  composePull,
  composeManualUpdate,
  composeLogs,
  composePs,
  getStackImages,
} from '../services/docker.js';
import { notifyStackAction } from '../services/discord.js';
import { registerStack, removeStack } from '../db.js';
import { stackDir } from '../services/docker.js';

type NameParams = { name: string };
const router = Router();

// List all stacks
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stacks = await listStacks();
    const details = await Promise.all(
      stacks.map(async (name) => {
        let status = 'unknown';
        let services: unknown[] = [];
        try {
          const psOutput = await composePs(name);
          services = psOutput.trim() ? JSON.parse(`[${psOutput.trim().split('\n').join(',')}]`) : [];
          if ((services as unknown[]).length === 0) {
            status = 'stopped';
          } else {
            status = (services as { State: string }[]).every(s => s.State === 'running') ? 'running' : 'partial';
          }
        } catch {
          status = 'stopped';
        }
        return { name, status, services };
      })
    );
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get stack compose content
router.get('/:name', async (req: Request<NameParams>, res: Response) => {
  try {
    const content = await getComposeContent(req.params.name);
    res.json({ name: req.params.name, content });
  } catch (err: any) {
    res.status(404).json({ error: `Stack not found: ${req.params.name}` });
  }
});

// Create or update stack
router.put('/:name', async (req: Request<NameParams>, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content (string) is required' });
      return;
    }
    await saveComposeContent(req.params.name, content);
    const sDir = stackDir(req.params.name);
    registerStack(req.params.name, sDir);
    res.json({ ok: true, name: req.params.name });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete stack
router.delete('/:name', async (req: Request<NameParams>, res: Response) => {
  try {
    await deleteStack(req.params.name);
    removeStack(req.params.name);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stack actions
router.post('/:name/up', async (req: Request<NameParams>, res: Response) => {
  try {
    if (req.query.stream === 'true') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      await composeUp(req.params.name, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
      await notifyStackAction(req.params.name, 'started', true);
      res.write(`data: ${JSON.stringify({ ok: true, finish: true })}\n\n`);
      res.end();
    } else {
      const output = await composeUp(req.params.name);
      await notifyStackAction(req.params.name, 'started', true);
      res.json({ ok: true, output });
    }
  } catch (err: any) {
    await notifyStackAction(req.params.name, 'start', false);
    if (req.query.stream === 'true') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.post('/:name/down', async (req: Request<NameParams>, res: Response) => {
  try {
    if (req.query.stream === 'true') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      await composeDown(req.params.name, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
      await notifyStackAction(req.params.name, 'stopped', true);
      res.write(`data: ${JSON.stringify({ ok: true, finish: true })}\n\n`);
      res.end();
    } else {
      const output = await composeDown(req.params.name);
      await notifyStackAction(req.params.name, 'stopped', true);
      res.json({ ok: true, output });
    }
  } catch (err: any) {
    await notifyStackAction(req.params.name, 'stop', false);
    if (req.query.stream === 'true') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.post('/:name/restart', async (req: Request<NameParams>, res: Response) => {
  try {
    if (req.query.stream === 'true') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      await composeRestart(req.params.name, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
      await notifyStackAction(req.params.name, 'restarted', true);
      res.write(`data: ${JSON.stringify({ ok: true, finish: true })}\n\n`);
      res.end();
    } else {
      const output = await composeRestart(req.params.name);
      await notifyStackAction(req.params.name, 'restarted', true);
      res.json({ ok: true, output });
    }
  } catch (err: any) {
    await notifyStackAction(req.params.name, 'restart', false);
    if (req.query.stream === 'true') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.post('/:name/pull', async (req: Request<NameParams>, res: Response) => {
  try {
    const output = await composePull(req.params.name);
    res.json({ ok: true, output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/update', async (req: Request<NameParams>, res: Response) => {
  try {
    if (req.query.stream === 'true') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      await composeManualUpdate(req.params.name, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
      await notifyStackAction(req.params.name, 'updated', true);
      res.write(`data: ${JSON.stringify({ ok: true, finish: true })}\n\n`);
      res.end();
    } else {
      const output = await composeManualUpdate(req.params.name);
      await notifyStackAction(req.params.name, 'updated', true);
      res.json({ ok: true, output });
    }
  } catch (err: any) {
    await notifyStackAction(req.params.name, 'update', false);
    if (req.query.stream === 'true') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.get('/:name/logs', async (req: Request<NameParams>, res: Response) => {
  try {
    const tail = parseInt(req.query.tail as string) || 100;
    const output = await composeLogs(req.params.name, Math.min(tail, 1000));
    res.json({ output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:name/images', async (req: Request<NameParams>, res: Response) => {
  try {
    const images = await getStackImages(req.params.name);
    res.json({ images });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
