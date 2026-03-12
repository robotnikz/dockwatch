import cron from 'node-cron';
import { getAllContainerStats } from './stats.js';
import { notifyStatusAlerts, type StatusAlert } from './discord.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { insertSchedulerEvent } from '../db.js';

const execFileAsync = promisify(execFile);

let monitorTask: cron.ScheduledTask | null = null;
let lastStates: Map<string, { status: string; health: string }> = new Map();

async function getDetailedStatus(): Promise<Map<string, { status: string; health: string }>> {
  const states = new Map<string, { status: string; health: string }>();
  try {
    const { stdout } = await execFileAsync('docker', [
      'ps', '-a', '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'
    ], { timeout: 10_000 });

    stdout.trim().split('\n').filter(Boolean).forEach(line => {
      const [name, state, statusStr] = line.split('\t');
      let health = '';
      if (statusStr.includes('(healthy)')) health = 'healthy';
      else if (statusStr.includes('(unhealthy)')) health = 'unhealthy';
      else if (statusStr.includes('(starting)')) health = 'starting';

      states.set(name, { status: state || 'unknown', health });
    });
  } catch (err) {
    console.error('[StatusMonitor] Failed to fetch docker statuses:', err);
    const message = err instanceof Error ? err.message : String(err);
    insertSchedulerEvent({ category: 'status-monitor', scope: 'docker-ps', level: 'error', message });
  }
  return states;
}

export async function checkStatusChanges(): Promise<void> {
  const currentStates = await getDetailedStatus();
  const alerts: StatusAlert[] = [];

  for (const [name, current] of currentStates.entries()) {
    const last = lastStates.get(name);
    if (!last) {
      lastStates.set(name, current);
      continue;
    }

    const statusChanged = last.status !== current.status;
    const healthChanged = last.health !== current.health;

    if (statusChanged || healthChanged) {
      // Only alert on "interesting" changes to avoid spam
      // e.g. status change (running -> exited) or health change (healthy -> unhealthy)
      const isDegraded = 
        (last.status === 'running' && current.status !== 'running') ||
        (last.health === 'healthy' && current.health === 'unhealthy') ||
        (current.health === 'unhealthy');

      if (isDegraded || statusChanged || healthChanged) {
         alerts.push({
          containerName: name,
          status: current.status,
          previousStatus: last.status,
          health: current.health,
          previousHealth: last.health
        });
      }
    }
    lastStates.set(name, current);
  }

  // Also check for deleted containers if needed, but usually we care about existing ones
  if (alerts.length > 0) {
    console.log(`[StatusMonitor] Detected ${alerts.length} status changes. Sending alerts.`);
    await notifyStatusAlerts(alerts);
  }
}

export function startStatusMonitor(): void {
  if (monitorTask) monitorTask.stop();
  
  // Initialize current state once
  getDetailedStatus().then(states => { lastStates = states; });

  // Run every minute for health/status checks
  monitorTask = cron.schedule('* * * * *', async () => {
    try {
      await checkStatusChanges();
    } catch (err) {
      console.error('[StatusMonitor] Error in status check:', err);
      const message = err instanceof Error ? err.message : String(err);
      insertSchedulerEvent({ category: 'status-monitor', scope: 'tick', level: 'error', message });
    }
  });
}

export function stopStatusMonitor(): void {
  if (monitorTask) {
    monitorTask.stop();
    monitorTask = null;
  }
}
