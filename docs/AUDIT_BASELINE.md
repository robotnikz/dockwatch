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
- Added stack action streaming route tests (SSE success and error paths) for operational reliability.
- Added scheduler decision-path tests for auto-update exclusion behavior.
- Added updates route tests for cached retrieval, full check trigger, single-image check, and error paths.

## Coverage Scope (Phase 1)
- Focused target: `server/src/services/resources.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`, `server/src/routes/settings.ts`
- Thresholds (initial practical baseline):
  - lines: 70
  - statements: 70
  - branches: 70
  - functions: 85

## Next Audit Steps
1. Expand coverage target to `routes/updates.ts` and `routes/stacks.ts` with phased thresholds.
2. Add integration-level tests for cleanup and dashboard routes.
3. Add benchmark baselines/threshold assertions for `perf:api` in CI (non-blocking first).
4. Produce PR report with prioritized optimization and security backlog from collected evidence.
