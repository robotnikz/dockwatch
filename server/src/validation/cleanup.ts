import type { CleanupConfig } from '../services/cleanup.js';
import { isObjectRecord, type ValidationResult } from './common.js';

const CLEANUP_TOP_LEVEL_KEYS = new Set([
  'scheduleEnabled',
  'scheduleFrequency',
  'scheduleTime',
  'protectionEnabled',
  'protectedImageLabels',
  'protectedVolumeLabels',
  'options',
]);

const CLEANUP_OPTION_KEYS = new Set(['containers', 'images', 'networks', 'volumes', 'buildCache']);
const CLEANUP_LABEL_MAX_ITEMS = 100;
const CLEANUP_LABEL_MAX_LENGTH = 128;

function validateLabelList(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return `${field} must be an array`;
  if (value.length > CLEANUP_LABEL_MAX_ITEMS) return `${field} has too many entries`;
  for (const entry of value) {
    if (typeof entry !== 'string') return `${field} entries must be strings`;
    if (entry.length > CLEANUP_LABEL_MAX_LENGTH) return `${field} entry too long`;
  }
  return null;
}

function validateCleanupOptions(value: unknown): string | null {
  if (!isObjectRecord(value)) return 'options must be an object';
  for (const [key, val] of Object.entries(value)) {
    if (!CLEANUP_OPTION_KEYS.has(key)) return `Unknown options field: ${key}`;
    if (typeof val !== 'boolean') return `options.${key} must be a boolean`;
  }
  return null;
}

export type CleanupRunPayload = { options?: CleanupConfig['options']; dryRun?: boolean };

export function validateCleanupConfigPayload(input: unknown): ValidationResult<Partial<CleanupConfig>> {
  if (!isObjectRecord(input)) return { ok: false, error: 'cleanup config must be an object' };

  for (const [key, val] of Object.entries(input)) {
    if (!CLEANUP_TOP_LEVEL_KEYS.has(key)) return { ok: false, error: `Unknown cleanup config field: ${key}` };

    if ((key === 'scheduleEnabled' || key === 'protectionEnabled') && typeof val !== 'boolean') {
      return { ok: false, error: `${key} must be a boolean` };
    }

    if (key === 'scheduleFrequency' && val !== 'daily' && val !== 'weekly' && val !== 'monthly') {
      return { ok: false, error: 'scheduleFrequency must be one of: daily, weekly, monthly' };
    }

    if (key === 'scheduleTime') {
      if (typeof val !== 'string') return { ok: false, error: 'scheduleTime must be a string' };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(val.trim())) {
        return { ok: false, error: 'scheduleTime must match HH:mm' };
      }
    }

    if (key === 'protectedImageLabels' || key === 'protectedVolumeLabels') {
      const err = validateLabelList(val, key);
      if (err) return { ok: false, error: err };
    }

    if (key === 'options') {
      const err = validateCleanupOptions(val);
      if (err) return { ok: false, error: err };
    }
  }

  return { ok: true, value: input as Partial<CleanupConfig> };
}

export function validateCleanupRunPayload(input: unknown): ValidationResult<CleanupRunPayload> {
  if (!isObjectRecord(input)) return { ok: false, error: 'cleanup run payload must be an object' };

  for (const [key, val] of Object.entries(input)) {
    if (key === 'dryRun') {
      if (typeof val !== 'boolean') return { ok: false, error: 'dryRun must be a boolean' };
      continue;
    }

    if (key === 'options') {
      const err = validateCleanupOptions(val);
      if (err) return { ok: false, error: err };
      continue;
    }

    return { ok: false, error: `Unknown cleanup run field: ${key}` };
  }

  return { ok: true, value: input as CleanupRunPayload };
}
