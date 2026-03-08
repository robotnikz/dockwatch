import type { ResourceConfig } from '../services/resources.js';
import { isObjectRecord, type ValidationResult } from './common.js';

const RESOURCE_KEYS = new Set([
  'limits_cpus',
  'limits_memory',
  'reservations_cpus',
  'reservations_memory',
  'update_excluded',
  'update_check_excluded',
]);

const MAX_RESOURCE_VALUE_LENGTH = 64;

export function validateResourceConfigPayload(input: unknown): ValidationResult<ResourceConfig> {
  if (!isObjectRecord(input)) return { ok: false, error: 'resource config must be an object' };

  for (const [key, val] of Object.entries(input)) {
    if (!RESOURCE_KEYS.has(key)) return { ok: false, error: `Unknown resource field: ${key}` };

    if (key === 'update_excluded' || key === 'update_check_excluded') {
      if (typeof val !== 'boolean') return { ok: false, error: `${key} must be a boolean` };
      continue;
    }

    if (val !== undefined && val !== null && typeof val !== 'string') {
      return { ok: false, error: `${key} must be a string` };
    }

    if (typeof val === 'string' && val.length > MAX_RESOURCE_VALUE_LENGTH) {
      return { ok: false, error: `${key} is too long` };
    }
  }

  return { ok: true, value: input as ResourceConfig };
}
