import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppVersionStatus: vi.fn(),
  getSelfUpdateInfo: vi.fn(),
  triggerSelfUpdate: vi.fn(),
}));

vi.mock('../src/services/appVersion.js', () => ({
  getAppVersionStatus: mocks.getAppVersionStatus,
}));

vi.mock('../src/services/selfUpdate.js', () => ({
  getSelfUpdateInfo: mocks.getSelfUpdateInfo,
  triggerSelfUpdate: mocks.triggerSelfUpdate,
}));

const { default: metaRouter } = await import('../src/routes/meta.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/meta', metaRouter);
  return app;
}

describe('meta routes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as any).mockReset();
      }
    });
  });

  it('returns app version status with self-update info', async () => {
    mocks.getAppVersionStatus.mockResolvedValue({
      currentVersion: '1.0.0',
      latestVersion: '1.0.1',
      updateAvailable: true,
    });
    mocks.getSelfUpdateInfo.mockReturnValue({ enabled: true, method: 'watchtower' });

    const res = await request(buildApp()).get('/meta/version?force=true');

    expect(res.status).toBe(200);
    expect(mocks.getAppVersionStatus).toHaveBeenCalledWith(true);
    expect(res.body.updateAvailable).toBe(true);
    expect(res.body.selfUpdate).toEqual({ enabled: true, method: 'watchtower' });
  });

  it('returns 500 when version status lookup fails', async () => {
    mocks.getAppVersionStatus.mockRejectedValue(new Error('version failed'));

    const res = await request(buildApp()).get('/meta/version');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('version failed');
  });

  it('triggers self-update and surfaces failures as 400', async () => {
    mocks.triggerSelfUpdate.mockReturnValue({ ok: true, pid: 123 });
    const ok = await request(buildApp()).post('/meta/self-update');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, pid: 123 });

    mocks.triggerSelfUpdate.mockImplementation(() => {
      throw new Error('cannot update');
    });
    const fail = await request(buildApp()).post('/meta/self-update');
    expect(fail.status).toBe(400);
    expect(fail.body.error).toContain('cannot update');
  });
});
