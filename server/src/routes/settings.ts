import { Router, type Request, type Response } from 'express';
import { getAllSettings, getSetting, setSetting } from '../db.js';
import { testWebhook } from '../services/discord.js';
import { restartScheduler } from '../services/scheduler.js';

const router = Router();

const ALLOWED_KEYS = [
  'discord_webhook',
  'discord_notify_actions',
  'discord_notify_container_updates',
  'discord_notify_prune_messages',
  'check_cron',
  'update_exclusions',
  'prunemate_url',
  'cleanup_schedule_enabled',
  'cleanup_schedule_frequency',
  'cleanup_schedule_time',
  'cleanup_protection_enabled',
  'cleanup_protected_image_labels',
  'cleanup_protected_volume_labels',
  'cleanup_option_containers',
  'cleanup_option_images',
  'cleanup_option_networks',
  'cleanup_option_volumes',
  'cleanup_option_build_cache',
  'cleanup_last_schedule_key',
];

const READONLY_UI_KEYS = new Set(['discord_webhook_set']);
const MAX_SETTING_VALUE_LENGTH = 4096;

function looksMaskedWebhook(value: string): boolean {
  const trimmed = String(value || '').trim();
  return trimmed.includes('...') && /^https?:\/\//i.test(trimmed);
}

function isPrimitiveSettingValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isWebhookLike(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isAllowedHost =
      host === 'discord.com' ||
      host === 'discordapp.com' ||
      host.endsWith('.discord.com') ||
      host.endsWith('.discordapp.com');
    return url.protocol === 'https:' && isAllowedHost && url.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

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
  const body = req.body as Record<string, unknown>;
  for (const [key, value] of Object.entries(body)) {
    if (READONLY_UI_KEYS.has(key)) {
      continue;
    }
    if (!ALLOWED_KEYS.includes(key)) {
      res.status(400).json({ error: `Unknown setting: ${key}` });
      return;
    }
    if (!isPrimitiveSettingValue(value)) {
      res.status(400).json({ error: `Invalid value type for setting: ${key}` });
      return;
    }

    const normalized = String(value);
    if (normalized.length > MAX_SETTING_VALUE_LENGTH) {
      res.status(400).json({ error: `Setting value too long: ${key}` });
      return;
    }

    // Frontend receives masked webhook text from GET; never persist that back.
    if (key === 'discord_webhook' && looksMaskedWebhook(normalized)) {
      continue;
    }
    if (key === 'discord_webhook' && !isWebhookLike(normalized)) {
      res.status(400).json({ error: 'Invalid Discord webhook URL format' });
      return;
    }

    setSetting(key, normalized);
  }
  // Restart scheduler if cron changed
  if ('check_cron' in body) {
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
