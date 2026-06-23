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

DockWatch requires access to Docker APIs (e.g. the Docker socket).

> **The Docker socket grants root-equivalent control of the host.** Any
> process that can reach the mounted socket can start privileged containers,
> bind-mount the host filesystem and therefore take over the host. Treat every
> DockWatch deployment as privileged.

Baseline practices:
- Do not expose directly to the public internet
- Place behind a VPN and/or authenticated reverse proxy
- Keep the host and container runtime up to date
- The default `docker-compose.yml` already sets `no-new-privileges` and ships a
  container `HEALTHCHECK`

### Limiting the Docker API surface (recommended)

Instead of mounting the raw socket, front it with a least-privilege
[`docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy) and
point DockWatch at it via `DOCKER_HOST`. Only the proxy touches the real socket
(read-only), and it exposes just the endpoints DockWatch needs:

```yaml
services:
  dockproxy:
    image: tecnativa/docker-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: 1
      IMAGES: 1
      NETWORKS: 1
      VOLUMES: 1
      POST: 1            # required to deploy / update / prune
      EXEC: 1            # required for log / terminal streaming
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks: [internal]

  dockwatch:
    image: ghcr.io/robotnikz/dockwatch:latest
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    environment:
      - DOCKER_HOST=tcp://dockproxy:2375
    networks: [internal, default]
    # ...ports / data / stacks volumes as in the default compose file

networks:
  internal:
    internal: true
```

Note: a plain `:ro` mount on the app container is **not** sufficient — the
Docker API is read/write over a read-only-mounted socket file. The proxy is the
real mitigation.

## Verifying image authenticity

Published images are signed with [cosign](https://github.com/sigstore/cosign)
(keyless / GitHub OIDC). Verify a pulled image before running it:

```sh
cosign verify \
  --certificate-identity-regexp 'https://github.com/robotnikz/dockwatch/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/robotnikz/dockwatch:latest
```
