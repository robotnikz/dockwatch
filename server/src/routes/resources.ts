import { Router, type Request, type Response } from 'express';
import { getStackResources, updateServiceResources, type ResourceConfig } from '../services/resources.js';

type StackParams = { name: string };
type ServiceParams = { name: string; service: string };
const router = Router();
const RESOURCE_KEYS = new Set([
  'limits_cpus',
  'limits_memory',
  'reservations_cpus',
  'reservations_memory',
  'update_excluded',
  'update_check_excluded',
]);
const MAX_RESOURCE_VALUE_LENGTH = 64;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateResourceConfigInput(value: unknown): string | null {
  if (!isObjectRecord(value)) return 'resource config must be an object';
  for (const [key, val] of Object.entries(value)) {
    if (!RESOURCE_KEYS.has(key)) return `Unknown resource field: ${key}`;

    if (key === 'update_excluded' || key === 'update_check_excluded') {
      if (typeof val !== 'boolean') return `${key} must be a boolean`;
      continue;
    }

    if (val !== undefined && val !== null && typeof val !== 'string') {
      return `${key} must be a string`;
    }

    if (typeof val === 'string' && val.length > MAX_RESOURCE_VALUE_LENGTH) {
      return `${key} is too long`;
    }
  }
  return null;
}

// Get all service resources for a stack
router.get('/:name', async (req: Request<StackParams>, res: Response) => {
  try {
    const resources = await getStackResources(req.params.name);
    res.json(resources);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update resources for a specific service
router.put('/:name/:service', async (req: Request<ServiceParams>, res: Response) => {
  try {
    const error = validateResourceConfigInput(req.body);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const config = req.body as ResourceConfig;
    const newContent = await updateServiceResources(req.params.name, req.params.service, config);
    res.json({ ok: true, content: newContent, needsRestart: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
