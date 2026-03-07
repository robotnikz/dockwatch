import { Router, type Request, type Response } from 'express';
import { getAllSettings, getSetting, setSetting } from '../db.js';
import { testWebhook } from '../services/discord.js';
import { restartScheduler } from '../services/scheduler.js';

const router = Router();

const ALLOWED_KEYS = ['discord_webhook', 'discord_notify_actions', 'check_cron', 'update_exclusions'];

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
  const body = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.includes(key)) {
      res.status(400).json({ error: `Unknown setting: ${key}` });
      return;
    }
    setSetting(key, value);
  }
  // Restart scheduler if cron changed
  if ('check_cron' in body) {
    restartScheduler();
  }
  res.json({ ok: true });
});

router.post('/test-webhook', async (_req: Request, res: Response) => {
  const ok = await testWebhook();
  res.json({ ok });
});

export default router;
