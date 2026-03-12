import { getSetting } from '../db.js';
import type { UpdateResult } from './updateChecker.js';
import type { CleanupRunResult } from './cleanup.js';

function isEnabledSetting(key: string, defaultValue = true): boolean {
  const value = getSetting(key);
  if (value == null || value === '') return defaultValue;
  return String(value).trim().toLowerCase() === 'true';
}

export async function sendDiscordMessage(content: string, embeds?: object[]): Promise<boolean> {
  const webhookUrl = getSetting('discord_webhook');
  if (!webhookUrl) return false;

  // Validate webhook URL format
  try {
    const url = new URL(webhookUrl);
    const host = url.hostname.toLowerCase();
    const isAllowedHost =
      host === 'discord.com' ||
      host === 'discordapp.com' ||
      host.endsWith('.discord.com') ||
      host.endsWith('.discordapp.com');

    if (url.protocol !== 'https:' || !isAllowedHost || !url.pathname.startsWith('/api/webhooks/')) {
      console.error('Invalid Discord webhook URL format');
      return false;
    }
  } catch {
    console.error('Invalid Discord webhook URL');
    return false;
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
    return false;
  }

  return true;
}

export async function notifyUpdatesAvailable(updates: UpdateResult[]): Promise<void> {
  if (updates.length === 0) return;
  if (!isEnabledSetting('discord_notify_container_updates', true)) return;

  const fields = updates.map(u => ({
    name: u.context ? `${u.context} (${u.image})` : u.image,
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
  if (!isEnabledSetting('discord_notify_prune_messages', true)) return;

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

export interface StatusAlert {
  containerName: string;
  status: string;
  previousStatus: string;
  health?: string;
  previousHealth?: string;
}

export async function notifyStatusAlerts(alerts: StatusAlert[]): Promise<void> {
  if (alerts.length === 0) return;
  if (!isEnabledSetting('discord_notify_status_changes', true)) return;

  const fields = alerts.map(a => {
    const statusPart = a.status !== a.previousStatus ? `Status: \`${a.previousStatus}\` ➔ \`${a.status}\`` : `Status: \`${a.status}\``;
    const healthPart = a.health !== a.previousHealth ? `Health: \`${a.previousHealth || 'unknown'}\` ➔ \`${a.health || 'unknown'}\`` : a.health ? `Health: \`${a.health}\`` : '';
    
    return {
      name: a.containerName,
      value: `${statusPart}${healthPart ? `\n${healthPart}` : ''}`,
      inline: false
    };
  });

  await sendDiscordMessage('', [{
    title: '⚠️ DockWatch — Container Status Alerts',
    color: 0xFAA61A,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'DockWatch Status Monitor' },
  }]);
}

export async function notifySchedulerError(category: string, message: string, scope?: string): Promise<void> {
  if (!isEnabledSetting('discord_notify_scheduler_errors', true)) return;

  const fields = [
    { name: 'Category', value: category, inline: true },
    { name: 'Scope', value: scope || 'global', inline: true },
    { name: 'Message', value: message.slice(0, 900), inline: false },
  ];

  await sendDiscordMessage('', [{
    title: '⚠️ DockWatch — Scheduler Error',
    color: 0xED4245,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'DockWatch Scheduler' },
  }]);
}

export async function testWebhook(): Promise<boolean> {
  try {
    return await sendDiscordMessage('🧪 DockWatch test notification - webhook is working!');
  } catch {
    return false;
  }
}
