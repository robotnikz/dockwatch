import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('api mount integration', () => {
  it('mounts all expected /api route groups', async () => {
    const app = createApp();

    const checks = await Promise.all([
      request(app).get('/api/settings'),
      request(app).get('/api/updates'),
      request(app).post('/api/convert').send({}),
      request(app).get('/api/resources/demo'),
      request(app).get('/api/meta/version'),
      request(app).get('/api/stacks'),
      request(app).get('/api/cleanup'),
      request(app).get('/api/stats'),
    ]);

    for (const res of checks) {
      expect(res.status).not.toBe(404);
    }
  });
});
