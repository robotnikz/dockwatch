import { getSetting, setSetting } from '../db.js';
import { getCleanupConfig, isCleanupRunning, runCleanup } from './cleanup.js';

let timer: NodeJS.Timeout | null = null;

function shouldRunNow(freq: 'daily' | 'weekly' | 'monthly', now: Date): boolean {
  if (freq === 'weekly') {
    return now.getDay() === 0; // Sunday
  }
  if (freq === 'monthly') {
    return now.getDate() === 1;
  }
  return true;
}

function windowKey(freq: 'daily' | 'weekly' | 'monthly', now: Date, hhmm: string): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${freq}:${day}:${hhmm}`;
}

async function tickCleanupScheduler(): Promise<void> {
  const config = getCleanupConfig();
  if (!config.scheduleEnabled) return;
  if (isCleanupRunning()) return;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (hhmm !== config.scheduleTime) return;
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
