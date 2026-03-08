import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStackResources: vi.fn(),
  updateServiceResources: vi.fn(),
}));

vi.mock('../src/services/resources.js', () => ({
  getStackResources: mocks.getStackResources,
  updateServiceResources: mocks.updateServiceResources,
}));

const { default: resourcesRouter } = await import('../src/routes/resources.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/resources', resourcesRouter);
  return app;
}

describe('resources routes', () => {
  beforeEach(() => {
    mocks.getStackResources.mockReset();
    mocks.updateServiceResources.mockReset();
  });

  it('returns resource data for all services in a stack', async () => {
    mocks.getStackResources.mockResolvedValue({
      app: {
        limits: { cpus: 1, memory: '512m' },
        reservations: { cpus: 0.5, memory: '256m' },
      },
    });

    const res = await request(buildApp()).get('/resources/demo');

    expect(res.status).toBe(200);
    expect(mocks.getStackResources).toHaveBeenCalledWith('demo');
    expect(res.body.app.limits.memory).toBe('512m');
  });

  it('returns 500 when reading stack resources fails', async () => {
    mocks.getStackResources.mockRejectedValue(new Error('read failed'));

    const res = await request(buildApp()).get('/resources/demo');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('read failed');
  });

  it('updates service resources and returns updated compose content', async () => {
    mocks.updateServiceResources.mockResolvedValue('services:\n  app:\n    deploy: {}\n');

    const payload = {
      limits: { cpus: 2, memory: '1g' },
      reservations: { cpus: 1, memory: '512m' },
      updateExclusions: true,
    };

    const res = await request(buildApp()).put('/resources/demo/app').send(payload);

    expect(res.status).toBe(200);
    expect(mocks.updateServiceResources).toHaveBeenCalledWith('demo', 'app', payload);
    expect(res.body).toEqual({ ok: true, content: 'services:\n  app:\n    deploy: {}\n', needsRestart: true });
  });

  it('returns 400 when update fails', async () => {
    mocks.updateServiceResources.mockRejectedValue(new Error('invalid resource config'));

    const res = await request(buildApp()).put('/resources/demo/app').send({ limits: { cpus: -1 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid resource config');
  });
});
