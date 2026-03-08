import { Router, type Request, type Response } from 'express';
import { getStackResources, updateServiceResources, type ResourceConfig } from '../services/resources.js';

type StackParams = { name: string };
type ServiceParams = { name: string; service: string };
const router = Router();

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
    const config = req.body as ResourceConfig;
    const newContent = await updateServiceResources(req.params.name, req.params.service, config);
    res.json({ ok: true, content: newContent, needsRestart: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
