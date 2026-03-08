import type express from 'express';

export interface ApiRateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 180;

export function createApiRateLimit(options: ApiRateLimitOptions = {}) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const buckets = new Map<string, Bucket>();

  return function apiRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';

    // Opportunistically remove expired entries for a small memory footprint.
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(bucketKey);
      }
    }

    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    existing.count += 1;
    next();
  };
}
