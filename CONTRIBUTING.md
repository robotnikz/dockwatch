# Contributing to DockWatch

Thanks for your interest in contributing.

## Development Setup

Requirements:
- Node.js 22+
- npm
- Docker (for runtime testing)

Install dependencies:

```bash
npm --prefix web ci
npm --prefix server ci
```

Run locally:

```bash
npm --prefix server run dev
npm --prefix web run dev
```

Build checks:

```bash
npm --prefix server run build
npm --prefix web run build
```

## Branch and PR Guidelines

- Keep changes focused and small.
- Use clear commit messages (e.g. `feat: ...`, `fix: ...`, `docs: ...`).
- Update docs when behavior changes.
- Add screenshots for UI changes when relevant.

Before opening a PR:
- Ensure `server` and `web` builds pass.
- Ensure no secrets are committed.
- Rebase/sync with `main` if needed.

## Code Style

- Prefer readable, explicit code over clever one-liners.
- Keep comments short and meaningful.
- Preserve existing conventions in each folder.

## Reporting Bugs and Requesting Features

Use the issue templates:
- Bug report
- Feature request

For setup/help questions, use Discussions.

## Security

Do not open public issues for vulnerabilities.
Please use the private reporting flow described in `SECURITY.md`.
