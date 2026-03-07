import cron from 'node-cron';
import { checkAllUpdates } from './updateChecker.js';
import { getSetting } from '../db.js';

let task: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  stopScheduler();

  const cronExpr = getSetting('check_cron') || '0 */6 * * *'; // default: every 6 hours

  if (!cron.validate(cronExpr)) {
    console.error(`Invalid cron expression: ${cronExpr}`);
    return;
  }

  task = cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Running update check at ${new Date().toISOString()}`);
    try {
      const results = await checkAllUpdates();
      const updates = results.filter(r => r.updateAvailable);
      console.log(`[Scheduler] Check complete. ${updates.length} updates available.`);
    } catch (err) {
      console.error('[Scheduler] Update check failed:', err);
    }
  });

  console.log(`[Scheduler] Started with cron: ${cronExpr}`);
}

export function stopScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

export function restartScheduler(): void {
  startScheduler();
}
