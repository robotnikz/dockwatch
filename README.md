<div align="center">

# 🐳 DockWatch

[![Stars](https://img.shields.io/github/stars/robotnikz/dockwatch?style=flat-square)](https://github.com/robotnikz/dockwatch/stargazers)
[![Issues](https://img.shields.io/github/issues/robotnikz/dockwatch?style=flat-square)](https://github.com/robotnikz/dockwatch/issues)
[![Last Commit](https://img.shields.io/github/last-commit/robotnikz/dockwatch?style=flat-square)](https://github.com/robotnikz/dockwatch/commits/main)
[![CI/CD Pipeline](https://img.shields.io/github/actions/workflow/status/robotnikz/dockwatch/ci.yml?style=flat-square&label=CI%2FCD%20Pipeline)](https://github.com/robotnikz/dockwatch/actions/workflows/ci.yml)
[![ghcr.io](https://img.shields.io/github/v/release/robotnikz/dockwatch?style=flat-square&label=ghcr.io)](https://github.com/robotnikz/dockwatch/pkgs/container/dockwatch)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Docker Compose](https://img.shields.io/badge/docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)

*A modern, lightweight Docker Compose control GUI for personal homelab use, bridging the gap between existing tools.*

</div>

---

> DockWatch started as a private homelab project to solve gaps I kept hitting in daily Docker Compose operations. It is now polished, tested, and available for anyone facing the same pain points.

## Contents

- [Features](#-features-at-a-glance)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration-compose)
- [Environment Variables](#environment-variables)
- [Authentication](#-authentication)
- [Screenshots](#-screenshots)
- [Security](#-security--deployment-recommendations)
- [Architecture](#-architecture-stack)
- [Honest Comparison](#-honest-comparison)
- [Shoutout](#-shoutout-to-the-ecosystem)
- [License](#-license)


## ✨ Features

* 📦 **Stack Management** — Build, deploy, and manage Docker Compose stacks via a clean, intuitive web UI.
* 📊 **Live Runtime Dashboard** — Real-time metrics for CPU, Memory, Network, Block I/O, and PIDs at a glance.
* 🔄 **Smart Updates & Exclusions** — Pull and redeploy stacks with one click. **Exclude specific containers from updates permanently with a simple toggle.**
* 🎛️ **Visual Resource Limits** — Control CPU and **RAM limits/reservations directly from the UI** without manual YAML editing. Changes sync instantly to your `compose.yml`!
* 💻 **Live Terminal Streaming** — View Docker Compose logs and process outputs in real-time through a responsive overlay.
* 🔔 **Discord Notifications** — Stay informed about available updates, automated checks, and stack events via Discord webhooks.
* 🪄 **Docker Run to Compose** — Instantly transform `docker run` commands into deployable `compose.yml` configurations.
* 🔐 **Built-in Authentication** — Persistent local account setup on first run, login sessions, logout, and in-app password change.

---

## 🚀 Quick Start

```bash
# Create directories
mkdir -p /opt/stacks /opt/dockwatch
cd /opt/dockwatch

# Download the default compose file
curl -o docker-compose.yml https://raw.githubusercontent.com/robotnikz/dockwatch/main/docker-compose.yml

# Spin up DockWatch
docker compose up -d
```

Open **http://<SERVER-IP>:3000** in your browser (replace `<SERVER-IP>` with your server's actual IP address).

On first start, DockWatch opens a setup page to create the initial admin user.

> Security note: DockWatch needs Docker API access (`/var/run/docker.sock`). Keep it on LAN/VPN or behind an authenticated reverse proxy.

## ⚙️ Configuration (Compose)

```yaml
services:
  dockwatch:
    image: ghcr.io/robotnikz/dockwatch:latest
    container_name: dockwatch
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
      # ⚠️ Stacks path MUST be identical on host and container!
      - /opt/stacks:/opt/stacks
    environment:
      - DOCKWATCH_STACKS=/opt/stacks
      - PORT=3000
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Web UI port |
| `DOCKWATCH_DATA` | `/app/data` | Database storage path |
| `DOCKWATCH_STACKS` | `/opt/stacks` | Compose stacks directory |

## 🔐 Authentication

- Built-in auth is enabled by default.
- Credentials are stored persistently in the DockWatch database.
- First run requires creating an admin account in the setup screen.
- After login, you can change the password from the user menu in the sidebar.
- Sessions use HttpOnly cookies with automatic secure-cookie behavior when running behind HTTPS/reverse proxy.

---

## 🖼️ Screenshots

### Dashboard

![DockWatch Dashboard](docs/screenshots/dashboard.png)

### Stack Editor

![DockWatch Stack Editor](docs/screenshots/stack_editor.png)

### Prune Assistant

![DockWatch Prune Assistant](docs/screenshots/prune_assistant.png)

---

## 🔒 Security & Deployment Recommendations

DockWatch undergoes routine automated security audits, including CodeQL scanning, dependabot vulnerability assessments, and strict linting. 

**However, mounting the Docker socket (`/var/run/docker.sock`) grants root-level execution capabilities to the container.** 

**Best Practices:**
1. **Never expose DockWatch directly to the public internet.**
2. Restrict access to local networks (LAN) or secure VPN overlays like **Tailscale**, **WireGuard**, or **Zerotier**.
3. If remote access is strictly required, use an authenticating reverse proxy (like Cloudflare Access, Authelia, or Authentik) with Multi-Factor Authentication.

---

## 🏗️ Architecture Stack

- **Backend:** Node.js, Express, `better-sqlite3`, TypeScript, Docker CLI proxying.
- **Frontend:** React 19, Vite, Tailwind CSS, `ansi_up` for proper terminal stream rendering.
- **CI/CD:** GitHub Actions with `semantic-release` directly deploying to GitHub Container Registry (GHCR).

---

## 🆚 Honest Comparison

Why create another Docker interface? Here's where DockWatch fits in:

| Feature / Aspect | 🐳 DockWatch | 🗂️ Dockge | 🚢 Portainer |
| :--- | :--- | :--- | :--- |
| **Primary Focus** | Personal Homelab management with automated updates | Minimalist Docker Compose management | Enterprise-grade Container, Swarm & K8s orchestration |
| **Auto-Updating** | Built-in (Cron + 1-Click + Discord alerts) | Requires external tools (e.g., Watchtower) | Paid features or external tooling required |
| **Resource Limits** | Native GUI controls for CPU & RAM | Manual YAML editing | GUI-based management |
| **Tech Stack** | React 19 + Node.js (Modern & Fast) | Vue.js + Node.js (Stable & Robust) | AngularJS + Go (Feature-rich/Heavy) |
| **Learning Curve** | Extremely Intuitive | Very Low | Moderate (Higher complexity) |

---

## 🙌 Shoutout to the Ecosystem

DockWatch was not built because other tools are bad. It was built because this ecosystem is full of great ideas worth building on.

Huge respect to:
- **Dockge** for the clean compose-first workflow
- **Portainer** for powerful all-in-one container management
- **Podman** / **Podman Desktop** for rootless-first container workflows
- and also **Watchtower**, **Dozzle**, **Lazydocker**, **Tugtainer** and many other OSS projects that make homelab and self-hosting better every day

DockWatch is ultimately my personal mix of the things I love most about these projects.
If you use these tools, please support the maintainers with stars, feedback, contributions, or sponsorship.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
