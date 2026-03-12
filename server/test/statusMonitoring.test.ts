import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSettingMock = vi.fn();

vi.mock('../src/db.js', () => ({
  getSetting: getSettingMock
}));

const { notifyStatusAlerts, sendDiscordMessage } = await import('../src/services/discord.js');

describe('discord service status alerts', () => {
  beforeEach(() => {
    // global.fetch logic moved here
    getSettingMock.mockReset();
    getSettingMock.mockReturnValue('https://discord.com/api/webhooks/test');
  });

  it('notifies status alerts when enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;

    getSettingMock.mockImplementation((key) => {
        if (key === 'discord_webhook') return 'https://discord.com/api/webhooks/test';
        if (key === 'discord_notify_status_changes') return 'true';
        return 'true';
    });

    const alerts = [
      { containerName: 'myapp', status: 'exited', previousStatus: 'running' }
    ];
    
    await notifyStatusAlerts(alerts);
    
    expect(global.fetch).toHaveBeenCalled();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.embeds[0].title).toContain('Container Status Alerts');
    expect(body.embeds[0].fields[0].name).toBe('myapp');
  });

  it('does not notify status alerts when disabled', async () => {
    global.fetch = vi.fn();
    getSettingMock.mockImplementation((key) => {
        if (key === 'discord_notify_status_changes') return 'false';
        return 'true';
    });
    
    await notifyStatusAlerts([{ containerName: 'test', status: 'running', previousStatus: 'exited' }]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
