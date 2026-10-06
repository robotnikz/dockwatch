import cron, { type ScheduledTask } from 'node-cron';
import { checkAllUpdates, getStackInterpolationEnv, resolveEnvVars } from './updateChecker.js';
import { getSetting, insertSchedulerEvent } from '../db.js';
import { composePullAndRecreate, getComposeContent, hasTrueLabel, listStacks } from './docker.js';
import { parse } from 'yaml';
import { notifySchedulerError, notifyStackAction } from './discord.js';

let task: ScheduledTask | null = null;
let isUpdateCycleRunning = false;

/** Auto-update is on unless explicitly disabled in the settings. */
export function isAutoUpdateEnabled(): boolean {
  return String(getSetting('auto_update_enabled') ?? 'true').trim().toLowerCase() !== 'false';
}

export async function runUpdateCycle({ applyUpdates = true }: { applyUpdates?: boolean } = {}): Promise<void> {
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
    if (!applyUpdates) {
      console.log('[Scheduler] Check-only run, not applying updates.');
      return;
    }
    if (!isAutoUpdateEnabled()) {
      console.log('[Scheduler] Auto-update is disabled in settings, not applying updates.');
      return;
    }

    const updatedImages = new Set(updates.map((u) => u.image));
    const stacks = await listStacks();

    for (const stack of stacks) {
      try {
        const compose = await getComposeContent(stack);
        const env = await getStackInterpolationEnv(stack);
        const services = getAutoUpdateServices(compose, updatedImages, env);

        if (services.length === 0) {
          console.log(`[Scheduler] No auto-update candidates in stack ${stack}.`);
          continue;
        }

        console.log(`[Scheduler] Applying auto-updates for stack ${stack} (${services.join(', ')})...`);
        const output = await composePullAndRecreate(stack, services);
        if (output.includes('No running, non-excluded services to update.')) {
          console.log(`[Scheduler] Nothing to update in stack ${stack}: affected services are not running.`);
          continue;
        }
        console.log(`[Scheduler] Auto-update complete for stack ${stack}.`);
        await notifyStackAction(stack, `auto-updated (${services.join(', ')})`, true);
      } catch (stackErr) {
        console.error(`[Scheduler] Auto-update failed for stack ${stack}:`, stackErr);
        const message = stackErr instanceof Error ? stackErr.message : String(stackErr);
        insertSchedulerEvent({ category: 'update-scheduler', scope: stack, level: 'error', message });
        await notifySchedulerError('update-scheduler', message, stack);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Update check failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    insertSchedulerEvent({ category: 'update-scheduler', scope: 'check-cycle', level: 'error', message });
    await notifySchedulerError('update-scheduler', message, 'check-cycle');
  } finally {
    isUpdateCycleRunning = false;
  }
}

/**
 * Services of a stack whose (variable-resolved) image has an update and that are not
 * excluded from auto-update via the `dockwatch.update.exclude` label.
 */
export function getAutoUpdateServices(
  composeContent: string,
  updatedImages: Set<string>,
  env: Record<string, string> = {},
): string[] {
  try {
    const doc = parse(composeContent) as any;
    const services = doc?.services;
    if (!services || typeof services !== 'object') return [];

    const result: string[] = [];
    for (const [serviceName, serviceConfig] of Object.entries(services)) {
      const service = serviceConfig as any;
      const image = typeof service?.image === 'string' ? resolveEnvVars(service.image, env).trim() : '';
      if (!image || !updatedImages.has(image)) continue;
      if (hasTrueLabel(service?.labels, 'dockwatch.update.exclude')) continue;
      result.push(serviceName);
    }
    return result;
  } catch {
    return [];
  }
}

export function hasAutoUpdateEnabledServiceWithUpdates(
  composeContent: string,
  updatedImages: Set<string>,
  env: Record<string, string> = {},
): boolean {
  return getAutoUpdateServices(composeContent, updatedImages, env).length > 0;
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

/**
 * Populate the update cache shortly after startup instead of waiting for the first cron
 * window. Startup never applies updates: a container restart (host reboot, DockWatch
 * update) must not recreate other stacks as a side effect.
 */
export function runStartupUpdateCheck(): void {
  void runUpdateCycle({ applyUpdates: false });
}
