import { getSetting, insertSchedulerEvent, setSetting } from '../db.js';
import { getCleanupConfig, isCleanupRunning, runCleanup } from './cleanup.js';
import { notifySchedulerError } from './discord.js';

let timer: NodeJS.Timeout | null = null;

function parseMinutes(hhmm: string): number {
  const match = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function hasReachedScheduleTime(scheduleTime: string, now: Date): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= parseMinutes(scheduleTime);
}

function shouldRunNow(freq: 'daily' | 'weekly' | 'monthly', now: Date): boolean {
  if (freq === 'weekly') {
    return now.getDay() === 0; // Sunday
  }
  if (freq === 'monthly') {
    return now.getDate() === 1;
  }
  return true;
}

export function getScheduleWindowId(freq: 'daily' | 'weekly' | 'monthly', now: Date): string {
  if (freq === 'monthly') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  if (freq === 'weekly') {
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - now.getDay());
    return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
  }

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function windowKey(freq: 'daily' | 'weekly' | 'monthly', now: Date, hhmm: string): string {
  const window = getScheduleWindowId(freq, now);
  return `${freq}:${window}:${hhmm}`;
}

async function tickCleanupScheduler(): Promise<void> {
  const config = getCleanupConfig();
  if (!config.scheduleEnabled) return;
  if (isCleanupRunning()) return;

  const now = new Date();

  if (!hasReachedScheduleTime(config.scheduleTime, now)) return;
  if (!shouldRunNow(config.scheduleFrequency, now)) return;

  const key = windowKey(config.scheduleFrequency, now, config.scheduleTime);
  const lastKey = getSetting('cleanup_last_schedule_key');
  if (lastKey === key) return;

  setSetting('cleanup_last_schedule_key', key);

  try {
    await runCleanup('scheduled', config);
    console.log(`[CleanupScheduler] Cleanup run completed for ${key}`);
  } catch (err) {
    console.error(`[CleanupScheduler] Cleanup run failed for ${key}:`, err);
    const message = err instanceof Error ? err.message : String(err);
    insertSchedulerEvent({ category: 'cleanup-scheduler', scope: key, level: 'error', message });
    await notifySchedulerError('cleanup-scheduler', message, key);
  }
}

export function startCleanupScheduler(): void {
  stopCleanupScheduler();
  timer = setInterval(() => {
    void tickCleanupScheduler();
  }, 60_000);
  // Also tick once on boot so exact startup-minute schedules are not missed.
  void tickCleanupScheduler();
  console.log('[CleanupScheduler] Started.');
}

export function stopCleanupScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function restartCleanupScheduler(): void {
  startCleanupScheduler();
}
