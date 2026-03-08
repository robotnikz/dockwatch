import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllSettings: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  testWebhook: vi.fn(),
  restartScheduler: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  getAllSettings: mocks.getAllSettings,
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
    mocks.getAllSettings.mockReset();
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
});
