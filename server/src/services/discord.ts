import { getSetting } from '../db.js';
import type { UpdateResult } from './updateChecker.js';
import type { CleanupRunResult } from './cleanup.js';

export async function sendDiscordMessage(content: string, embeds?: object[]): Promise<void> {
  const webhookUrl = getSetting('discord_webhook');
  if (!webhookUrl) return;

  // Validate webhook URL format
  try {
    const url = new URL(webhookUrl);
    if (!url.hostname.endsWith('discord.com') || !url.pathname.startsWith('/api/webhooks/')) {
      console.error('Invalid Discord webhook URL format');
      return;
    }
  } catch {
    console.error('Invalid Discord webhook URL');
    return;
  }

  const body: Record<string, unknown> = { username: 'DockWatch' };
  if (content) body.content = content;
  if (embeds) body.embeds = embeds;

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error(`Discord webhook failed: ${resp.status} ${resp.statusText}`);
  }
}

export async function notifyUpdatesAvailable(updates: UpdateResult[]): Promise<void> {
  if (updates.length === 0) return;

  const fields = updates.map(u => ({
    name: u.image,
    value: `🔄 Update available`,
    inline: false,
  }));

  await sendDiscordMessage('', [{
    title: '🐳 DockWatch — Updates Available',
    color: 0x5865F2,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'DockWatch Update Checker' },
  }]);
}

export async function notifyStackAction(stackName: string, action: string, success: boolean): Promise<void> {
  const notifyActions = getSetting('discord_notify_actions');
  if (notifyActions !== 'true') return;

  const color = success ? 0x57F287 : 0xED4245;
  const emoji = success ? '✅' : '❌';

  await sendDiscordMessage('', [{
    title: `${emoji} Stack ${action}`,
    description: `**${stackName}** — ${action} ${success ? 'succeeded' : 'failed'}`,
    color,
    timestamp: new Date().toISOString(),
    footer: { text: 'DockWatch' },
  }]);
}

export async function notifyCleanupRun(result: CleanupRunResult): Promise<void> {
  const notifyActions = getSetting('discord_notify_actions');
  if (notifyActions !== 'true') return;

  const color = result.success ? 0x57F287 : 0xED4245;
  const emoji = result.success ? '🧹' : '⚠️';

  const fields = [
    { name: 'Reason', value: result.reason, inline: true },
    { name: 'Reclaimed', value: result.reclaimedHuman, inline: true },
    { name: 'Deleted', value: `c:${result.deleted.containers} i:${result.deleted.images} n:${result.deleted.networks} v:${result.deleted.volumes} b:${result.deleted.buildCache}`, inline: false },
  ];

  if (result.error) {
    fields.push({ name: 'Error', value: result.error.slice(0, 900), inline: false });
  }

  await sendDiscordMessage('', [{
    title: `${emoji} Docker cleanup ${result.success ? 'completed' : 'failed'}`,
    color,
    fields,
    timestamp: result.finishedAt,
    footer: { text: 'DockWatch Cleanup' },
  }]);
}

export async function testWebhook(): Promise<boolean> {
  try {
    await sendDiscordMessage('🧪 DockWatch test notification — webhook is working!');
    return true;
  } catch {
    return false;
  }
}
