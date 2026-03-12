import { isObjectRecord, type ValidationResult } from './common.js';

const ALLOWED_KEYS = new Set([
  'discord_webhook',
  'discord_notify_actions',
  'discord_notify_container_updates',
  'discord_notify_prune_messages',
  'discord_notify_status_changes',
  'discord_notify_scheduler_errors',
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
]);

const READONLY_UI_KEYS = new Set(['discord_webhook_set']);
const MAX_SETTING_VALUE_LENGTH = 4096;

function isPrimitiveSettingValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function looksMaskedWebhook(value: string): boolean {
  const trimmed = String(value || '').trim();
  return trimmed.includes('...') && /^https?:\/\//i.test(trimmed);
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

export interface SettingsUpdatePayload {
  values: Record<string, string>;
  shouldRestartScheduler: boolean;
}

export function validateSettingsUpdatePayload(input: unknown): ValidationResult<SettingsUpdatePayload> {
  if (!isObjectRecord(input)) {
    return { ok: false, error: 'settings payload must be an object' };
  }

  const values: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(input)) {
    if (READONLY_UI_KEYS.has(key)) continue;

    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `Unknown setting: ${key}` };
    }

    if (!isPrimitiveSettingValue(rawValue)) {
      return { ok: false, error: `Invalid value type for setting: ${key}` };
    }

    const normalized = String(rawValue);
    if (normalized.length > MAX_SETTING_VALUE_LENGTH) {
      return { ok: false, error: `Setting value too long: ${key}` };
    }

    if (key === 'discord_webhook' && looksMaskedWebhook(normalized)) {
      continue;
    }

    if (key === 'discord_webhook' && !isWebhookLike(normalized)) {
      return { ok: false, error: 'Invalid Discord webhook URL format' };
    }

    values[key] = normalized;
  }

  return {
    ok: true,
    value: {
      values,
      shouldRestartScheduler: Object.prototype.hasOwnProperty.call(input, 'check_cron'),
    },
  };
}
