import { Router, type Request, type Response } from 'express';
import { getStackResources, updateServiceResources, type ResourceConfig } from '../services/resources.js';
import { validateResourceConfigPayload } from '../validation/resources.js';
import { badRequest, internalServerError } from '../utils/httpResponses.js';

type StackParams = { name: string };
type ServiceParams = { name: string; service: string };
const router = Router();

// Get all service resources for a stack
router.get('/:name', async (req: Request<StackParams>, res: Response) => {
  try {
    const resources = await getStackResources(req.params.name);
    res.json(resources);
  } catch (err: any) {
    internalServerError(res, err);
  }
});

// Update resources for a specific service
router.put('/:name/:service', async (req: Request<ServiceParams>, res: Response) => {
  try {
    const validated = validateResourceConfigPayload(req.body);
    if (!validated.ok) {
      badRequest(res, validated.error);
      return;
    }
    const config = validated.value as ResourceConfig;
    const newContent = await updateServiceResources(req.params.name, req.params.service, config);
    res.json({ ok: true, content: newContent, needsRestart: true });
  } catch (err: any) {
    badRequest(res, String(err?.message || 'Invalid resource config'));
  }
});

export default router;
