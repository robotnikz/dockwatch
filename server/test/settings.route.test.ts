import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSchedulerEvents: vi.fn(),
  getAllSettings: vi.fn(),
  getLatestSchedulerEvents: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  testWebhook: vi.fn(),
  restartScheduler: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  clearSchedulerEvents: mocks.clearSchedulerEvents,
  getAllSettings: mocks.getAllSettings,
  getLatestSchedulerEvents: mocks.getLatestSchedulerEvents,
  getSetting: mocks.getSetting,
  setSetting: mocks.setSetting,
}));

vi.mock('../src/services/discord.js', () => ({
  testWebhook: mocks.testWebhook,
}));

vi.mock('../src/services/scheduler.js', () => ({
  restartScheduler: mocks.restartScheduler,
}));

const { default: settingsRouter } = await import('../src/routes/settings.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/settings', settingsRouter);
  return app;
}

describe('settings routes', () => {
  beforeEach(() => {
    mocks.clearSchedulerEvents.mockReset();
    mocks.getAllSettings.mockReset();
    mocks.getLatestSchedulerEvents.mockReset();
    mocks.getSetting.mockReset();
    mocks.setSetting.mockReset();
    mocks.testWebhook.mockReset();
    mocks.restartScheduler.mockReset();
  });

  it('masks webhook in GET response and exposes webhook_set marker', async () => {
    mocks.getAllSettings.mockReturnValue({
      discord_webhook: 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz',
      check_cron: '0 1 * * *',
    });

    const res = await request(buildApp()).get('/settings');

    expect(res.status).toBe(200);
    expect(res.body.discord_webhook_set).toBe('true');
    expect(String(res.body.discord_webhook)).toContain('...');
    expect(res.body.check_cron).toBe('0 1 * * *');
  });

  it('accepts allowed settings and restarts scheduler when cron changes', async () => {
    const payload = {
      check_cron: '0 2 * * *',
      cleanup_option_images: 'true',
      discord_webhook_set: 'true',
      discord_webhook: 'https://discord.com/api/webhooks/123/abc',
    };

    const res = await request(buildApp()).put('/settings').send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.setSetting).toHaveBeenCalledWith('check_cron', '0 2 * * *');
    expect(mocks.setSetting).toHaveBeenCalledWith('cleanup_option_images', 'true');
    expect(mocks.setSetting).toHaveBeenCalledWith('discord_webhook', 'https://discord.com/api/webhooks/123/abc');
    expect(mocks.setSetting).not.toHaveBeenCalledWith('discord_webhook_set', 'true');
    expect(mocks.restartScheduler).toHaveBeenCalledTimes(1);
  });

  it('ignores masked webhook values on PUT', async () => {
    const payload = {
      discord_webhook: 'https://discord.com/api/webhooks/1234567890/...masked....',
    };

    const res = await request(buildApp()).put('/settings').send(payload);

    expect(res.status).toBe(200);
    expect(mocks.setSetting).not.toHaveBeenCalledWith('discord_webhook', expect.anything());
  });

  it('rejects unknown settings', async () => {
    const res = await request(buildApp()).put('/settings').send({ nope: '1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown setting: nope');
  });

  it('rejects non-primitive setting values', async () => {
    const res = await request(buildApp()).put('/settings').send({ check_cron: { bad: true } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid value type for setting: check_cron');
  });

  it('rejects overly long values', async () => {
    const longValue = 'x'.repeat(5000);
    const res = await request(buildApp()).put('/settings').send({ update_exclusions: longValue });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Setting value too long: update_exclusions');
  });

  it('rejects invalid webhook urls', async () => {
    const res = await request(buildApp()).put('/settings').send({ discord_webhook: 'http://example.com/not-discord' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid Discord webhook URL format');
  });

  it('returns 400 when webhook test fails', async () => {
    mocks.testWebhook.mockResolvedValue(false);

    const res = await request(buildApp()).post('/settings/test-webhook');

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 200 when webhook test succeeds', async () => {
    mocks.testWebhook.mockResolvedValue(true);

    const res = await request(buildApp()).post('/settings/test-webhook');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns scheduler diagnostics and supports reset', async () => {
    mocks.getLatestSchedulerEvents.mockReturnValue([{ id: 1, category: 'cleanup-scheduler' }]);

    const listRes = await request(buildApp()).get('/settings/scheduler-events?limit=5');
    expect(listRes.status).toBe(200);
    expect(mocks.getLatestSchedulerEvents).toHaveBeenCalledWith(5);
    expect(listRes.body.events).toHaveLength(1);

    const resetRes = await request(buildApp()).post('/settings/scheduler-events/reset');
    expect(resetRes.status).toBe(200);
    expect(resetRes.body).toEqual({ ok: true });
    expect(mocks.clearSchedulerEvents).toHaveBeenCalledTimes(1);
  });
});
