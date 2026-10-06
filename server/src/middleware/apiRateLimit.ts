import type { Options } from 'express-rate-limit';

export interface ApiRateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 180;

/**
 * Shared options for express-rate-limit: per-client-IP fixed window, 429 with a JSON
 * error and a Retry-After header. Call `rateLimit(apiRateLimitOptions(...))` at the
 * place where the limiter is defined, so static analysis (CodeQL) can see it.
 */
export function apiRateLimitOptions(options: ApiRateLimitOptions = {}): Partial<Options> {
  return {
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
    limit: options.maxRequests ?? DEFAULT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  };
}
