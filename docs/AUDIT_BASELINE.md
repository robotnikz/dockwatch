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

## Coverage Scope (Phase 1)
- Focused target: `server/src/services/resources.ts`
- Thresholds (initial practical baseline):
  - lines: 70
  - statements: 70
  - branches: 70
  - functions: 85

## Next Audit Steps
1. Add tests for `updateChecker.ts` registry validation and exclusion handling.
2. Add middleware tests for API rate limiting behavior.
3. Add route-level tests for settings webhook flow (masked value handling and read-only keys).
4. Introduce lightweight load/perf sanity script for API hot paths.
5. Expand coverage target to additional security-sensitive modules.
