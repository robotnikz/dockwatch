import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllContainerStats: vi.fn(),
  getHostInfo: vi.fn(),
}));

vi.mock('../src/services/stats.js', () => ({
  getAllContainerStats: mocks.getAllContainerStats,
  getHostInfo: mocks.getHostInfo,
}));

const { default: statsRouter } = await import('../src/routes/stats.js');

function buildApp() {
  const app = express();
  app.use('/stats', statsRouter);
  return app;
}

describe('stats routes', () => {
  beforeEach(() => {
    mocks.getAllContainerStats.mockReset();
    mocks.getHostInfo.mockReset();
  });

  it('returns combined dashboard payload', async () => {
    mocks.getAllContainerStats.mockResolvedValue([{ id: 'c1', cpuPercent: 2.1 }]);
    mocks.getHostInfo.mockResolvedValue({ uptimeSec: 123, cpuCores: 8 });

    const res = await request(buildApp()).get('/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      host: { uptimeSec: 123, cpuCores: 8 },
      containers: [{ id: 'c1', cpuPercent: 2.1 }],
    });
  });

  it('returns container-only stats and host-only stats', async () => {
    mocks.getAllContainerStats.mockResolvedValue([{ id: 'c1' }]);
    mocks.getHostInfo.mockResolvedValue({ uptimeSec: 999 });

    const containers = await request(buildApp()).get('/stats/containers');
    expect(containers.status).toBe(200);
    expect(containers.body).toEqual([{ id: 'c1' }]);

    const host = await request(buildApp()).get('/stats/host');
    expect(host.status).toBe(200);
    expect(host.body).toEqual({ uptimeSec: 999 });
  });

  it('returns 500 when services fail', async () => {
    mocks.getAllContainerStats.mockRejectedValueOnce(new Error('stats failed'));
    const rootFail = await request(buildApp()).get('/stats');
    expect(rootFail.status).toBe(500);
    expect(rootFail.body.error).toContain('stats failed');

    mocks.getAllContainerStats.mockRejectedValueOnce(new Error('containers failed'));
    const containersFail = await request(buildApp()).get('/stats/containers');
    expect(containersFail.status).toBe(500);
    expect(containersFail.body.error).toContain('containers failed');

    mocks.getHostInfo.mockRejectedValueOnce(new Error('host failed'));
    const hostFail = await request(buildApp()).get('/stats/host');
    expect(hostFail.status).toBe(500);
    expect(hostFail.body.error).toContain('host failed');
  });
});
