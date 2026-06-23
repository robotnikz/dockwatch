import { Router, type Request, type Response } from 'express';
import { clearSchedulerEvents, getAllSettings, getLatestSchedulerEvents, getSetting, setSetting } from '../db.js';
import { testWebhook } from '../services/discord.js';
import { restartScheduler } from '../services/scheduler.js';
import { validateSettingsUpdatePayload } from '../validation/settings.js';
import { badRequest } from '../utils/httpResponses.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const settings = getAllSettings();
  // Mask webhook URL in response: never echo any part of the secret token.
  // Keep the '...' marker so the client treats the value as unchanged on save.
  if (settings.discord_webhook) {
    settings.discord_webhook_set = 'true';
    let host = 'discord.com';
    try {
      host = new URL(String(settings.discord_webhook)).host || host;
    } catch {
      // Keep the default host on malformed stored values.
    }
    settings.discord_webhook = `https://${host}/api/webhooks/***...`;
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

router.get('/scheduler-events', (req: Request, res: Response) => {
  const rawLimit = Number.parseInt(String(req.query.limit || '20'), 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
  const events = getLatestSchedulerEvents(limit);
  res.json({ events });
});

router.post('/scheduler-events/reset', (_req: Request, res: Response) => {
  clearSchedulerEvents();
  res.json({ ok: true });
});

export default router;
