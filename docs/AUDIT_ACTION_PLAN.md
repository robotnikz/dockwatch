# Audit Action Plan (Execution Backlog)

Date: 2026-03-08
Branch: `main` (merged from `audit/performance-architecture-security-coverage`)

## Goal
Turn the completed audit baseline into incremental, low-risk improvements that can be merged continuously.

Current mode: `Implementation completed and merged; document retained as an execution record`.

## Recommended Workflow
1. Keep working on the audit branch in small vertical slices (code + tests + docs).
2. Use one atomic commit per measure (clear rollback and review scope).
3. Run local gate before each push:
   - `cd server && npm run test:coverage && npm run build`
   - `cd web && npm run build`
4. Push each slice and keep PR updated continuously.
5. Keep CI perf checks non-blocking at first; only make them blocking after 2-3 stable runs.

## Priority Measures

### P0 - Security and Input Hardening
- [x] Add strict validation for `cleanup` config payload shape and bounds.
- [x] Add request-size and string-length guard tests for `convert` and `resources` payloads.
- [x] Add route tests for malformed query/path values (`logs?tail=-1`, huge values, non-numeric values).
- Done: `logs?tail` invalid/negative/zero handling was implemented and tested.
- Done: malformed payload/path coverage exists for cleanup/resources/convert routes.
- [x] Add explicit safe defaults for optional booleans in route bodies (`dryRun`, exclusions flags).
- Done: route validation now enforces boolean types when flags are provided and keeps safe defaults when omitted.

### P1 - Reliability and Regression Guardrails
- [x] Add integration test for API mount paths in `src/index.ts` with a lightweight app harness.
- [x] Add one end-to-end happy path that touches stack lifecycle (`up -> logs -> down`) with mocked services.
- [x] Add test for cleanup reset conflict race (run state flips between check and reset).

### P1 - Performance
- [x] Add baseline capture file for `perf:api` outputs (req/s + p95 latency).
- [x] Add optional CI workflow dispatch for `perf:api` and upload benchmark artifact.
- [x] Add threshold warnings (non-blocking) for regressions vs baseline (+/- percentage).

### P2 - Architecture and Maintainability
- [x] Extract shared route error handling helper to reduce repeated `try/catch` response patterns.
- [x] Add typed request payload schemas for high-risk routes (`settings`, `cleanup`, `resources`).
- [x] Add module-level docs for scheduler/update-check interaction assumptions.

## Merge Strategy
1. Merge P0 items first with tests.
2. Merge P1 reliability next.
3. Merge P1 performance instrumentation once stable in CI.
4. Merge P2 refactors only if test coverage remains stable.

## Definition of Done per Measure
- Tests added/updated and passing.
- Coverage gate still green.
- No build regressions (`server` + `web`).
- `docs/AUDIT_BASELINE.md` updated with the change.

## Audit Finalization Artifacts
- Baseline log: `docs/AUDIT_BASELINE.md`
- Vertical completion report: `docs/AUDIT_VERTICALS_REPORT.md`
- Execution backlog (this file): `docs/AUDIT_ACTION_PLAN.md`

## Final Status
- Core backlog objectives P0/P1/P2 are complete on this branch.
- Remaining work is optional tuning after merge (coverage depth for low-risk branches, perf threshold calibration over multiple CI runs).
