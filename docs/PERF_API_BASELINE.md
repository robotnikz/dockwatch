# PERF API Baseline

Date: 2026-03-08
Source command: `cd server && npm run perf:api`
Environment: local benchmark script (`server/scripts/perf-api.mjs`), temporary server instance

## Latest Baseline Snapshot
- `GET /api/settings`
- req/s avg: `5289.88`
- latency avg: `3.37ms`

- `GET /api/updates`
- req/s avg: `5277.50`
- latency avg: `3.37ms`

## Notes
- These values are point-in-time local baselines and should be compared as trend signals, not absolute guarantees.
- CI benchmark runs can be triggered via `.github/workflows/perf-api.yml` and downloaded as artifacts.
- CI already applies non-blocking threshold warnings against this baseline in `.github/workflows/perf-api.yml`.
