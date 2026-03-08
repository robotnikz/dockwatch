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

## Coverage Scope (Phase 1)
- Focused target: `server/src/services/resources.ts`
- Expanded target: `server/src/services/resources.ts`, `server/src/middleware/apiRateLimit.ts`
- Thresholds (initial practical baseline):
  - lines: 70
  - statements: 70
  - branches: 70
  - functions: 85

## Next Audit Steps
1. Add route-level tests for settings webhook flow (masked value handling and read-only keys).
2. Introduce lightweight load/perf sanity script for API hot paths.
3. Expand coverage target to additional security-sensitive modules.
4. Add architectural guard tests around scheduler/update-check interactions.
