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
      limits_cpus: '2',
      limits_memory: '1g',
      reservations_cpus: '1',
      reservations_memory: '512m',
      update_excluded: true,
      update_check_excluded: false,
    };

    const res = await request(buildApp()).put('/resources/demo/app').send(payload);

    expect(res.status).toBe(200);
    expect(mocks.updateServiceResources).toHaveBeenCalledWith('demo', 'app', payload);
    expect(res.body).toEqual({ ok: true, content: 'services:\n  app:\n    deploy: {}\n', needsRestart: true });
  });

  it('returns 400 when update fails', async () => {
    mocks.updateServiceResources.mockRejectedValue(new Error('invalid resource config'));

    const res = await request(buildApp()).put('/resources/demo/app').send({ limits_cpus: '1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid resource config');
  });

  it('rejects malformed resource payloads before service call', async () => {
    const badType = await request(buildApp()).put('/resources/demo/app').send([]);
    expect(badType.status).toBe(400);
    expect(badType.body.error).toContain('resource config must be an object');

    const unknownKey = await request(buildApp()).put('/resources/demo/app').send({ unknown: true });
    expect(unknownKey.status).toBe(400);
    expect(unknownKey.body.error).toContain('Unknown resource field: unknown');

    const badBoolean = await request(buildApp()).put('/resources/demo/app').send({ update_excluded: 'yes' });
    expect(badBoolean.status).toBe(400);
    expect(badBoolean.body.error).toContain('update_excluded must be a boolean');

    const tooLong = await request(buildApp()).put('/resources/demo/app').send({ limits_memory: 'x'.repeat(128) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toContain('limits_memory is too long');

    const badCpu = await request(buildApp()).put('/resources/demo/app').send({ limits_cpus: 'abc' });
    expect(badCpu.status).toBe(400);
    expect(badCpu.body.error).toContain('limits_cpus must be a positive number');

    const badMemory = await request(buildApp()).put('/resources/demo/app').send({ limits_memory: '99x' });
    expect(badMemory.status).toBe(400);
    expect(badMemory.body.error).toContain('limits_memory must be a valid memory value');

    expect(mocks.updateServiceResources).not.toHaveBeenCalled();
  });
});
