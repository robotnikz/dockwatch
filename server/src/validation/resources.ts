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

function isValidCpuValue(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return false;
  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) && numeric > 0;
}

function isValidMemoryValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Docker-compatible shorthand (e.g. 512m, 1g, 2GiB, 1024k, 1048576).
  return /^\d+(?:\.\d+)?(?:[bkmgte]i?b?|[kmgte])?$/i.test(trimmed);
}

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

    if (typeof val === 'string' && val.trim() !== '') {
      if ((key === 'limits_cpus' || key === 'reservations_cpus') && !isValidCpuValue(val)) {
        return { ok: false, error: `${key} must be a positive number (example: 0.5, 1, 2)` };
      }

      if ((key === 'limits_memory' || key === 'reservations_memory') && !isValidMemoryValue(val)) {
        return { ok: false, error: `${key} must be a valid memory value (example: 512m, 1g, 2GiB)` };
      }
    }
  }

  return { ok: true, value: input as ResourceConfig };
}
