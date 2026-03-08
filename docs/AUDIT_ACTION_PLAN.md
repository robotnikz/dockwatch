# Audit Action Plan (Execution Backlog)

Date: 2026-03-08
Branch: `audit/performance-architecture-security-coverage`

## Goal
Turn the completed audit baseline into incremental, low-risk improvements that can be merged continuously.

Current mode: `Audit complete, implementation deferred until explicit start signal`.

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
- [ ] Add strict validation for `cleanup` config payload shape and bounds.
- [ ] Add request-size and string-length guard tests for `convert` and `resources` payloads.
- [~] Add route tests for malformed query/path values (`logs?tail=-1`, huge values, non-numeric values).
- Done: `logs?tail` invalid/negative/zero handling was implemented and tested.
- Remaining: extend malformed coverage to additional query/path inputs across cleanup/resources endpoints.
- [ ] Add explicit safe defaults for optional booleans in route bodies (`dryRun`, exclusions flags).

### P1 - Reliability and Regression Guardrails
- [ ] Add integration test for API mount paths in `src/index.ts` with a lightweight app harness.
- [ ] Add one end-to-end happy path that touches stack lifecycle (`up -> logs -> down`) with mocked services.
- [ ] Add test for cleanup reset conflict race (run state flips between check and reset).

### P1 - Performance
- [ ] Add baseline capture file for `perf:api` outputs (req/s + p95 latency).
- [ ] Add optional CI workflow dispatch for `perf:api` and upload benchmark artifact.
- [ ] Add threshold warnings (non-blocking) for regressions vs baseline (+/- percentage).

### P2 - Architecture and Maintainability
- [ ] Extract shared route error handling helper to reduce repeated `try/catch` response patterns.
- [ ] Add typed request payload schemas for high-risk routes (`settings`, `cleanup`, `resources`).
- [ ] Add module-level docs for scheduler/update-check interaction assumptions.

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
