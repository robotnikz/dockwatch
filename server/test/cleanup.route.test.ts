import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCleanupDashboardSync: vi.fn(),
  getCleanupPreview: vi.fn(),
  isCleanupRunning: vi.fn(),
  resetCleanupStatistics: vi.fn(),
  runCleanup: vi.fn(),
  saveCleanupConfig: vi.fn(),
  restartCleanupScheduler: vi.fn(),
}));

vi.mock('../src/services/cleanup.js', () => ({
  getCleanupDashboardSync: mocks.getCleanupDashboardSync,
  getCleanupPreview: mocks.getCleanupPreview,
  isCleanupRunning: mocks.isCleanupRunning,
  resetCleanupStatistics: mocks.resetCleanupStatistics,
  runCleanup: mocks.runCleanup,
  saveCleanupConfig: mocks.saveCleanupConfig,
}));

vi.mock('../src/services/cleanupScheduler.js', () => ({
  restartCleanupScheduler: mocks.restartCleanupScheduler,
}));

const { default: cleanupRouter } = await import('../src/routes/cleanup.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/cleanup', cleanupRouter);
  return app;
}

describe('cleanup routes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as any).mockReset();
      }
    });
  });

  it('returns cleanup dashboard and tolerates preview lookup failures', async () => {
    mocks.getCleanupPreview.mockRejectedValueOnce(new Error('preview unavailable'));
    mocks.getCleanupDashboardSync.mockReturnValue({ lastRunAt: null, running: false });

    const res = await request(buildApp()).get('/cleanup');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lastRunAt: null, running: false });
    expect(mocks.getCleanupDashboardSync).toHaveBeenCalledWith(null);
  });

  it('updates cleanup config and restarts scheduler', async () => {
    mocks.saveCleanupConfig.mockReturnValue({ schedule: '0 3 * * *', options: { removeDangling: true } });

    const res = await request(buildApp())
      .put('/cleanup/config')
      .send({ schedule: '0 3 * * *', options: { removeDangling: true } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mocks.saveCleanupConfig).toHaveBeenCalled();
    expect(mocks.restartCleanupScheduler).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for invalid cleanup config', async () => {
    mocks.saveCleanupConfig.mockImplementation(() => {
      throw new Error('invalid cleanup config');
    });

    const res = await request(buildApp()).put('/cleanup/config').send({ schedule: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid cleanup config');
  });

  it('runs cleanup in dry-run mode and returns result', async () => {
    mocks.saveCleanupConfig.mockReturnValue({ options: { removeDangling: true } });
    mocks.runCleanup.mockResolvedValue({ reclaimedBytes: 1234, deletedImages: 2 });

    const res = await request(buildApp())
      .post('/cleanup/run?dryRun=true')
      .send({ options: { removeDangling: true } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mocks.runCleanup).toHaveBeenCalledWith(
      'manual',
      { options: { removeDangling: true } },
      { dryRun: true }
    );
  });

  it('streams cleanup output via SSE and marks finish', async () => {
    mocks.saveCleanupConfig.mockReturnValue({ options: { removeDangling: true } });
    mocks.runCleanup.mockImplementation(async (_source: string, _cfg: unknown, opts: { onChunk?: (chunk: string) => void }) => {
      opts.onChunk?.('scan start\n');
      opts.onChunk?.('scan done\n');
      return { reclaimedBytes: 0, deletedImages: 0 };
    });

    const res = await request(buildApp())
      .post('/cleanup/run?stream=true')
      .send({ options: { removeDangling: true } });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('scan start');
    expect(res.text).toContain('scan done');
    expect(res.text).toContain('"finish":true');
  });

  it('returns stream and json errors on cleanup failure', async () => {
    mocks.saveCleanupConfig.mockReturnValue({ options: {} });
    mocks.runCleanup.mockRejectedValue(new Error('cleanup failed'));

    const jsonRes = await request(buildApp()).post('/cleanup/run').send({});
    expect(jsonRes.status).toBe(500);
    expect(jsonRes.body.error).toContain('cleanup failed');

    const sseRes = await request(buildApp()).post('/cleanup/run?stream=true').send({});
    expect(sseRes.status).toBe(200);
    expect(sseRes.text).toContain('cleanup failed');
  });

  it('returns preview and handles preview errors', async () => {
    mocks.getCleanupPreview.mockResolvedValueOnce({ reclaimableBytes: 42 });
    const ok = await request(buildApp()).get('/cleanup/preview');
    expect(ok.status).toBe(200);
    expect(ok.body.reclaimableBytes).toBe(42);

    mocks.getCleanupPreview.mockRejectedValueOnce(new Error('preview failed'));
    const fail = await request(buildApp()).get('/cleanup/preview');
    expect(fail.status).toBe(500);
    expect(fail.body.error).toContain('preview failed');
  });

  it('resets statistics when idle and rejects while running', async () => {
    mocks.isCleanupRunning.mockReturnValueOnce(true);
    const conflict = await request(buildApp()).post('/cleanup/reset');
    expect(conflict.status).toBe(409);

    mocks.isCleanupRunning.mockReturnValueOnce(false);
    const ok = await request(buildApp()).post('/cleanup/reset');
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(mocks.resetCleanupStatistics).toHaveBeenCalledTimes(1);
  });
});
