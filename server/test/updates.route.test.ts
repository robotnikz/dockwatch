import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkAllUpdatesMock = vi.fn();
const checkImageUpdateMock = vi.fn();
const getCachedUpdatesMock = vi.fn();

vi.mock('../src/services/updateChecker', () => ({
  checkAllUpdates: checkAllUpdatesMock,
  checkImageUpdate: checkImageUpdateMock,
  getCachedUpdates: getCachedUpdatesMock,
}));

describe('updates routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function buildApp() {
    const { default: updatesRouter } = await import('../src/routes/updates');
    const app = express();
    app.use(express.json());
    app.use('/updates', updatesRouter);
    return app;
  }

  it('returns cached updates and status', async () => {
    getCachedUpdatesMock.mockReturnValue([{ id: 'u1' }]);

    const res = await request(await buildApp()).get('/updates');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'u1' }]);
  });

  it('triggers full update check', async () => {
    checkAllUpdatesMock.mockResolvedValue([{ image: 'nginx:latest', updateAvailable: true }]);

    const res = await request(await buildApp()).post('/updates/check').send({ includePreReleases: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ image: 'nginx:latest', updateAvailable: true }]);
    expect(checkAllUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it('checks a specific image', async () => {
    checkImageUpdateMock.mockResolvedValue({ image: 'nginx:latest', updateAvailable: true });

    const res = await request(await buildApp()).post('/updates/check/nginx:latest');

    expect(res.status).toBe(200);
    expect(checkImageUpdateMock).toHaveBeenCalledWith('nginx:latest');
    expect(res.body.updateAvailable).toBe(true);
  });

  it('surfaces single-image check errors', async () => {
    checkImageUpdateMock.mockRejectedValueOnce(new Error('image-check-failed'));

    const res = await request(await buildApp()).post('/updates/check/nginx:latest');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('image-check-failed');
  });

  it('surfaces internal errors', async () => {
    checkAllUpdatesMock.mockRejectedValueOnce(new Error('boom'));

    const res = await request(await buildApp()).post('/updates/check');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('boom');
  });
});
