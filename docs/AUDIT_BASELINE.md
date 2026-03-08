# Audit Baseline (Performance, Architecture, Security)

Date: 2026-03-08
Branch: `audit/performance-architecture-security-coverage`

## Current State
- Server and web build successfully.
- No automated tests existed initially.
- CI originally typechecked and built only.

## Implemented in this audit phase
- Added server test framework with Vitest + V8 coverage.
- Added CI execution for server tests with coverage.
- Added security-focused unit tests for `resources.ts`:
  - prototype-pollution key rejection for service names
  - forbidden label key stripping (`__proto__`, `prototype`, `constructor`)
  - exclusion label toggling for map and array labels
  - deploy/resources write and cleanup behavior
- Added IO tests for compose load/save integration functions in resources service.
- Refactored API rate limiting into dedicated middleware for testability and cleaner architecture.
- Added middleware unit tests for rate-limit window, rejection path, and reset behavior.
- Added update-checker helper tests for image parsing, host allowlisting, and safe URL construction.
- Added route-level tests for settings webhook flow (masked values, readonly keys, scheduler restart, error handling).
- Hardened settings write-path input validation:
  - rejects non-primitive values
  - enforces maximum value length guard
  - validates Discord webhook URL format before persistence
- Added lightweight performance sanity script for hot-path pure functions.
- Added API load sanity benchmark script (`perf:api`) using autocannon against running local server endpoints.
- Wired `perf:sanity` into CI as a non-blocking signal to continuously surface perf drift.
- Added manual CI benchmark workflow for `perf:api` with benchmark output artifact upload.
- Added `docs/PERF_API_BASELINE.md` with initial API throughput/latency baseline snapshot.
- Added non-blocking CI threshold warnings in `perf-api` workflow to surface req/s drops and latency increases.
- Added stack action streaming route tests (SSE success and error paths) for operational reliability.
- Added scheduler decision-path tests for auto-update exclusion behavior.
- Added updates route tests for cached retrieval, full check trigger, single-image check, and error paths.
- Expanded stacks route tests for list/status derivation, non-stream action success/failure, logs/images, and detail/delete paths.
- Added cleanup route tests for config updates, run/stream execution, preview/reset behavior, and error handling.
- Added stats route tests for aggregate/containers/host endpoints and failure paths.
- Added meta route tests for version/status retrieval and self-update trigger error handling.
- Added convert route tests for payload validation and conversion error behavior.
- Added resources route tests for stack fetch/update success and error paths.
- Hardened cleanup route payload validation for config/run endpoints (shape, enum, time format, option booleans, label list bounds).
- Hardened convert route with command normalization and max-length guard.
- Hardened resources update route with strict field allowlist, value type checks, and per-field length caps.
- Added negative tests covering malformed payload handling for cleanup/convert/resources routes.
- Refactored app bootstrap to `createApp()` (`src/app.ts`) for integration-testable API mounts without server side effects.
- Added API mount integration test using app harness.
- Added stack lifecycle happy-path test (`up -> logs -> down`) with mocked docker service calls.
- Added cleanup reset race-path handling and test (maps race to HTTP 409 conflict).

## Coverage Scope (Phase 1)
- Focused target: `server/src/services/resources.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`, `server/src/routes/settings.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`, `server/src/routes/settings.ts`, `server/src/routes/updates.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`, `server/src/routes/settings.ts`, `server/src/routes/updates.ts`, `server/src/routes/stacks.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`, `server/src/routes/settings.ts`, `server/src/routes/updates.ts`, `server/src/routes/stacks.ts`, `server/src/routes/cleanup.ts`, `server/src/routes/stats.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`, `server/src/routes/settings.ts`, `server/src/routes/updates.ts`, `server/src/routes/stacks.ts`, `server/src/routes/cleanup.ts`, `server/src/routes/stats.ts`, `server/src/routes/meta.ts`, `server/src/routes/convert.ts`, `server/src/routes/resources.ts`
- Thresholds (initial practical baseline):
  - lines: 70
  - statements: 70
  - branches: 70
  - functions: 85

## Next Audit Steps
1. Audit verticals are complete; use `docs/AUDIT_VERTICALS_REPORT.md` as the finalized technical snapshot.
2. Keep backlog execution deferred until implementation start is explicitly requested.
3. When implementation starts, execute items in `docs/AUDIT_ACTION_PLAN.md` from P0 to P2.
4. Open PR with baseline + vertical report + action plan to track execution slices.
