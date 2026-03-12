# Security Policy

## Supported Versions

DockWatch is actively maintained on the `main` branch and latest published image tag.
Older tags may not receive security fixes.

## Reporting a Vulnerability

Please report security vulnerabilities privately.

Preferred method:
- GitHub Security Advisories: https://github.com/robotnikz/dockwatch/security/advisories/new

Include, if possible:
- Affected version/image tag
- Environment details (OS, architecture, deployment method)
- Reproduction steps or proof of concept
- Impact assessment

Please do not publish exploit details in public issues before a fix is available.

## Response Expectations

We aim to:
- Acknowledge reports quickly
- Reproduce and validate findings
- Ship a fix and publish guidance as soon as possible

## Hardening Notes

DockWatch requires access to Docker APIs (e.g. Docker socket).
Treat deployments as privileged and follow least-privilege practices:
- Do not expose directly to the public internet
- Place behind VPN and/or authenticated reverse proxy
- Keep host and container runtime up to date
