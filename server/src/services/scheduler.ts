import cron from 'node-cron';
import { checkAllUpdates } from './updateChecker.js';
import { getSetting } from '../db.js';
import { composePullAndRecreate, getComposeContent, listStacks } from './docker.js';
import { parse } from 'yaml';

let task: cron.ScheduledTask | null = null;
let isUpdateCycleRunning = false;

async function runUpdateCycle(): Promise<void> {
  if (isUpdateCycleRunning) {
    console.log('[Scheduler] Previous update cycle still running, skipping this run.');
    return;
  }

  isUpdateCycleRunning = true;
  console.log(`[Scheduler] Running update check at ${new Date().toISOString()}`);
  try {
    const results = await checkAllUpdates();
    const updates = results.filter(r => r.updateAvailable);
    console.log(`[Scheduler] Check complete. ${updates.length} updates available.`);

    if (updates.length === 0) return;

    const updatedImages = new Set(updates.map((u) => u.image));
    const stacks = await listStacks();

    for (const stack of stacks) {
      try {
        const compose = await getComposeContent(stack);
        const shouldAutoUpdate = hasAutoUpdateEnabledServiceWithUpdates(compose, updatedImages);

        if (!shouldAutoUpdate) {
          console.log(`[Scheduler] No auto-update candidates in stack ${stack}.`);
          continue;
        }

        console.log(`[Scheduler] Applying auto-updates for stack ${stack}...`);
        await composePullAndRecreate(stack);
        console.log(`[Scheduler] Auto-update complete for stack ${stack}.`);
      } catch (stackErr) {
        console.error(`[Scheduler] Auto-update failed for stack ${stack}:`, stackErr);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Update check failed:', err);
  } finally {
    isUpdateCycleRunning = false;
  }
}

function isTrueLabel(value: unknown): boolean {
  return String(value).trim().toLowerCase() === 'true';
}

function hasAutoUpdateEnabledServiceWithUpdates(
  composeContent: string,
  updatedImages: Set<string>
): boolean {
  try {
    const doc = parse(composeContent) as any;
    const services = doc?.services;
    if (!services || typeof services !== 'object') return false;

    for (const serviceConfig of Object.values(services)) {
      const service = serviceConfig as any;
      const image = service?.image;
      if (!image || !updatedImages.has(String(image))) continue;

      const labels = service?.labels;
      const autoExcluded = Array.isArray(labels)
        ? labels.some((l: unknown) => {
            if (typeof l !== 'string') return false;
            const [k, v] = l.split('=');
            return k === 'dockwatch.update.exclude' && isTrueLabel(v);
          })
        : (labels && typeof labels === 'object'
          ? isTrueLabel((labels as Record<string, unknown>)['dockwatch.update.exclude'])
          : false);

      if (!autoExcluded) return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function startScheduler(): void {
  stopScheduler();

  const cronExpr = getSetting('check_cron') || '0 */6 * * *'; // default: every 6 hours

  if (!cron.validate(cronExpr)) {
    console.error(`Invalid cron expression: ${cronExpr}`);
    return;
  }

  task = cron.schedule(cronExpr, async () => {
    await runUpdateCycle();
  });

  console.log(`[Scheduler] Started with cron: ${cronExpr}`);

  // Populate cache shortly after startup instead of waiting for the first cron window.
  void runUpdateCycle();
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
