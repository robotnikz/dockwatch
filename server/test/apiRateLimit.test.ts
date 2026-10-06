import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiRateLimitOptions } from '../src/middleware/apiRateLimit.js';

function buildApp(windowMs: number, maxRequests: number) {
  const app = express();
  app.use(rateLimit(apiRateLimitOptions({ windowMs, maxRequests })));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('api rate limit middleware', () => {
  it('allows requests up to configured max', async () => {
    const app = buildApp(60_000, 2);

    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(200);
  });

  it('rejects requests over configured max with retry header and JSON error', async () => {
    const app = buildApp(60_000, 1);

    await request(app).get('/ping');
    const blocked = await request(app).get('/ping');

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body).toEqual({ error: 'Too many requests' });
  });

  it('resets count after window elapsed', async () => {
    const app = buildApp(200, 1);

    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await request(app).get('/ping')).status).toBe(200);
  });

  it('uses defaults of 180 requests per minute', () => {
    expect(apiRateLimitOptions()).toMatchObject({ windowMs: 60_000, limit: 180 });
  });
});
