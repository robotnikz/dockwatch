# Scheduler and Update-Check Assumptions

Date: 2026-03-08

## Purpose
Document operational assumptions between scheduled update checks, cache state, and auto-update behavior.

## Assumptions
- Scheduler runs update checks based on `check_cron` and may update cache state used by `/api/updates` and UI badges.
- Update-check exclusions are controlled via compose labels and must be respected by auto-update decisions.
- Auto-update decisions only apply to services that are not excluded and have update availability in cache/check result.
- Manual update actions (`stack update`, service update) can run independently of scheduler timing.
- Cleanup scheduler operates independently of update scheduler but shares process resources.

## Consistency Expectations
- Changing `check_cron` via settings triggers scheduler restart immediately.
- Route-level validation must prevent malformed scheduler-related settings from being persisted.
- Scheduler and cleanup operations should surface conflicts through explicit API errors when concurrent actions are unsafe.

## Testing Coverage Pointers
- `server/test/scheduler.test.ts`: decision-path logic around exclusion and update availability.
- `server/test/settings.route.test.ts`: scheduler restart behavior on settings updates.
- `server/test/updates.route.test.ts`: update route trigger and error path behavior.
