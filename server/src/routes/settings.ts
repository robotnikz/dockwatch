import { Router, type Request, type Response } from 'express';
import { getAllSettings, getSetting, setSetting } from '../db.js';
import { testWebhook } from '../services/discord.js';
import { restartScheduler } from '../services/scheduler.js';
import { validateSettingsUpdatePayload } from '../validation/settings.js';
import { badRequest } from '../utils/httpResponses.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const settings = getAllSettings();
  // Mask webhook URL in response
  if (settings.discord_webhook) {
    settings.discord_webhook_set = 'true';
    const url = settings.discord_webhook;
    settings.discord_webhook = url.substring(0, 40) + '...' + url.substring(url.length - 10);
  }
  res.json(settings);
});

router.put('/', (req: Request, res: Response) => {
  const validated = validateSettingsUpdatePayload(req.body);
  if (!validated.ok) {
    badRequest(res, validated.error);
    return;
  }

  for (const [key, value] of Object.entries(validated.value.values)) {
    setSetting(key, value);
  }

  if (validated.value.shouldRestartScheduler) {
    restartScheduler();
  }
  res.json({ ok: true });
});

router.post('/test-webhook', async (_req: Request, res: Response) => {
  const ok = await testWebhook();
  if (!ok) {
    res.status(400).json({ ok: false, error: 'Discord webhook test failed. Check webhook URL and notification settings.' });
    return;
  }
  res.json({ ok: true });
});

export default router;
