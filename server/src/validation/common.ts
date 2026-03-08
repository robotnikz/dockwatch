export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
