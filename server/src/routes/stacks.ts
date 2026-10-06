import { Router, type Response } from 'express';
import type { Request } from 'express';
import {
  listStacks,
  getComposeContent,
  saveComposeContent,
  getEnvContent,
  saveEnvContent,
  getComposeFileName,
  listExtraStackFiles,
  stackExists,
  validateComposeConfig,
  deleteStack,
  composeUp,
  composeDown,
  composeRestart,
  composePull,
  composeManualUpdate,
  composeManualUpdateService,
  composeLogs,
  composeContainerLogs,
  getContainersByProject,
  computeStackStatus,
  getStackImages,
  type StackContainer,
} from '../services/docker.js';
import { notifyStackAction } from '../services/discord.js';
import { registerStack, removeStack } from '../db.js';
import { stackDir, isValidComposeServiceName } from '../services/docker.js';
import { deleteStackHistory, getStackHistoryVersion, listStackHistory, snapshotStack } from '../services/stackHistory.js';
import { parseDocument } from 'yaml';

type NameParams = { name: string };
type NameServiceParams = { name: string; service: string };
type NameVersionParams = { name: string; version: string };
const router = Router();

// List all stacks
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stacks = await listStacks();
    let containers: Map<string, StackContainer[]> | null = null;
    try {
      containers = await getContainersByProject();
    } catch (err) {
      console.error('[Stacks] Failed to list containers:', err);
    }

    const details = stacks.map((name) => {
      if (!containers) return { name, status: 'unknown', services: [] };
      const services = containers.get(name.toLowerCase()) ?? [];
      return { name, status: computeStackStatus(services), services };
    });
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get stack compose and .env content
router.get('/:name', async (req: Request<NameParams>, res: Response) => {
  let content: string;
  try {
    content = await getComposeContent(req.params.name);
  } catch {
    res.status(404).json({ error: `Stack not found: ${req.params.name}` });
    return;
  }

  try {
    const [env, composeFile, extraFiles] = await Promise.all([
      getEnvContent(req.params.name),
      getComposeFileName(req.params.name),
      listExtraStackFiles(req.params.name),
    ]);
    res.json({ name: req.params.name, path: stackDir(req.params.name), content, env, composeFile, extraFiles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update stack.
// Body: { content: string, env?: string, create?: boolean }
// - `env` omitted: the .env file is left untouched.
// - `create: true`: refuses to overwrite an existing stack (409).
router.put('/:name', async (req: Request<NameParams>, res: Response) => {
  try {
    const { content, env, create } = req.body ?? {};
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content (string) is required' });
      return;
    }
    if (env !== undefined && typeof env !== 'string') {
      res.status(400).json({ error: 'env must be a string' });
      return;
    }

    const doc = parseDocument(content, { prettyErrors: true });
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      res.status(400).json({ error: `Invalid YAML: ${first.message}` });
      return;
    }

    const name = req.params.name;
    const sDir = stackDir(name);
    const exists = await stackExists(name);
    if (create === true && exists) {
      res.status(409).json({ error: `Stack "${name}" already exists. Open it from the sidebar to edit it.` });
      return;
    }

    const warnings: string[] = [];
    if (exists) {
      const previousContent = await getComposeContent(name);
      const previousEnv = await getEnvContent(name);
      const envChanged = env !== undefined && env !== (previousEnv ?? '');
      if (previousContent !== content || envChanged) {
        try {
          await snapshotStack(name, { content: previousContent, env: previousEnv });
        } catch (err: any) {
          warnings.push(`Previous version could not be saved to history: ${err.message}`);
        }
      }
    }

    await saveComposeContent(name, content);
    if (env !== undefined) {
      await saveEnvContent(name, env);
    }
    registerStack(name, sDir);

    warnings.push(...await validateComposeConfig(name));
    res.json({ ok: true, name, warnings });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete stack
router.delete('/:name', async (req: Request<NameParams>, res: Response) => {
  try {
    await deleteStack(req.params.name);
    await deleteStackHistory(req.params.name);
    removeStack(req.params.name);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Previous versions of the compose/.env files
router.get('/:name/history', async (req: Request<NameParams>, res: Response) => {
  try {
    res.json({ versions: await listStackHistory(req.params.name) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:name/history/:version', async (req: Request<NameVersionParams>, res: Response) => {
  try {
    res.json(await getStackHistoryVersion(req.params.name, req.params.version));
  } catch (err: any) {
    const status = err?.code === 'ENOENT' ? 404 : 400;
    res.status(status).json({ error: status === 404 ? 'Version not found' : err.message });
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

router.post('/:name/update/:service', async (req: Request<NameServiceParams>, res: Response) => {
  try {
    const { name, service } = req.params;
    if (req.query.stream === 'true') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      await composeManualUpdateService(name, service, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
      await notifyStackAction(name, `updated service ${service}`, true);
      res.write(`data: ${JSON.stringify({ ok: true, finish: true })}\n\n`);
      res.end();
    } else {
      const output = await composeManualUpdateService(name, service);
      await notifyStackAction(name, `updated service ${service}`, true);
      res.json({ ok: true, output });
    }
  } catch (err: any) {
    await notifyStackAction(req.params.name, `update service ${req.params.service}`, false);
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
    const parsedTail = Number.parseInt(String(req.query.tail ?? ''), 10);
    const tail = Number.isFinite(parsedTail) ? Math.min(Math.max(parsedTail, 1), 1000) : 100;
    const container = req.query.container as string | undefined;

    if (container !== undefined && !isValidComposeServiceName(container)) {
      res.status(400).json({ error: 'Invalid container name' });
      return;
    }

    let output = '';
    if (container) {
      output = await composeContainerLogs(req.params.name, container, tail);
    } else {
      output = await composeLogs(req.params.name, tail);
    }
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
