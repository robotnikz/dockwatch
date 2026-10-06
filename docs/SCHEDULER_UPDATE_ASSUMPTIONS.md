# Scheduler and Update-Check Assumptions

Date: 2026-03-08

## Purpose
Document operational assumptions between scheduled update checks, cache state, and auto-update behavior.

## Assumptions
- Scheduler runs update checks based on `check_cron` and updates the cache used by `/api/updates` and UI badges.
- The startup run only checks for updates; it never applies them (a reboot or DockWatch update must not recreate other stacks).
- Image references are resolved with the stack's `.env` (plus the minimal compose process environment) before checking and before matching auto-update candidates.
- Update-check exclusions are controlled via compose labels and must be respected by auto-update decisions.
- Auto-update can be switched off globally (`auto_update_enabled=false`); the scheduler then only checks and notifies.
- Auto-update only applies to services that are not excluded, have an update, and are currently running. It runs `pull <services>` and `up -d --no-deps <services>`; stopped stacks and services stay stopped.
- Manual update actions (`stack update`, service update) can run independently of scheduler timing.
- Mutating compose operations are serialized per stack, so scheduler and UI actions never run concurrently on the same project.
- Each compose run has a timeout (`DOCKWATCH_COMPOSE_TIMEOUT_MS`, default 30 minutes) so a hung pull cannot block the queue.
- The update cache is pruned to the images found in the last full check; Discord is notified once per new remote digest.
- Cleanup scheduler operates independently of update scheduler but shares process resources.

## Consistency Expectations
- Changing `check_cron` via settings triggers scheduler restart immediately.
- Route-level validation must prevent malformed scheduler-related settings from being persisted.
- Scheduler and cleanup operations should surface conflicts through explicit API errors when concurrent actions are unsafe.

## Testing Coverage Pointers
- `server/test/scheduler.test.ts`: decision-path logic around exclusion and update availability.
- `server/test/scheduler.cycle.test.ts`: check-only startup run, auto-update toggle, `.env` image resolution, per-stack failures.
- `server/test/docker.service.test.ts`: exact compose arguments for manual, service and auto updates, timeouts and per-stack locking.
- `server/test/updateChecker.check.test.ts`: manifest Accept types, repo digest matching, cache pruning and notification dedupe.
- `server/test/settings.route.test.ts`: scheduler restart behavior on settings updates.
- `server/test/updates.route.test.ts`: update route trigger and error path behavior.
