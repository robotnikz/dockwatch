# 🐳 DockWatch

A Docker Compose control surface with live runtime stats, update checks, command conversion, and Discord notifications.

## Features

- **Stack Management** — Create, edit, start, stop, and delete Docker Compose stacks via web UI
- **Live Runtime Dashboard** — View host-level Docker info plus live per-container CPU, memory, network, block I/O, and PID stats
- **Update Checker** — Automatically detects when container images have new versions available
- **One-Click Updates** — Pull latest images and recreate containers with a single click
- **Discord Notifications** — Get notified about available updates and stack actions via Discord webhook
- **Scheduled Checks** — Configurable cron schedule for automatic update checking
- **Container Logs** — View container logs directly in the UI
- **Docker Run Converter** — Turn a `docker run` command into a `compose.yaml` starter
- **Resource Controls** — Edit CPU and RAM limits/reservations from the GUI without hand-editing YAML

## Quick Start

```bash
# Create directories (same structure as Dockge for easy migration)
mkdir -p /opt/stacks /opt/dockwatch
cd /opt/dockwatch

# Download the docker-compose.yml
curl -o docker-compose.yml https://raw.githubusercontent.com/robotnikz/dockwatch/main/docker-compose.yml

# Start DockWatch
docker compose up -d
```

Open **http://localhost:3000** in your browser.

## What DockWatch Writes

DockWatch stores stacks under the same layout used by Dockge:

- Stacks live in `/opt/stacks/<stack-name>/`
- New stacks are written as `/opt/stacks/<stack-name>/compose.yaml`
- Existing `docker-compose.yml` files are still read for compatibility

When you edit resources from the UI, DockWatch:

- Detects existing `deploy.resources.*` values
- Detects existing service-level Compose keys such as `cpus`, `mem_limit`, and `mem_reservation`
- Writes a canonical `deploy.resources` block
- Mirrors compatible values back to `cpus`, `mem_limit`, and `mem_reservation` for broader Docker Compose compatibility

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Web UI port |
| `DOCKWATCH_DATA` | `/app/data` | Database storage path |
| `DOCKWATCH_STACKS` | `/opt/stacks` | Compose stacks directory |

### Docker Compose

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
      # ⚠️ Stacks path MUST be identical on host and container
      - /opt/stacks:/opt/stacks
    environment:
      - DOCKWATCH_STACKS=/opt/stacks
```

### Discord Webhook

1. Go to **Settings** in the DockWatch UI
2. Paste your Discord webhook URL
3. Click **Save Settings**
4. Click **Send Test Notification** to verify

### Update Schedule

Default: every 6 hours (`0 */6 * * *`).  
Change it in **Settings** using standard cron syntax.

## Main UI Areas

### Dashboard

- Stack overview with running, degraded, and stopped states
- Live Docker host telemetry and container stats
- Fast actions for start, stop, update, logs, and resources

### Converter

- Paste a `docker run ...` command
- Convert it to Compose YAML
- Copy the result or send it directly into the stack editor

### Resource Management

- Edit CPU limits and reservations
- Edit memory limits and reservations
- Preview the exact YAML DockWatch will write
- Restart the stack after saving to apply changes

### Settings

- Configure Discord webhook delivery
- Enable or disable action notifications
- Set the update-check cron schedule

## Architecture

```
dockwatch/
├── server/          # Express.js backend (TypeScript)
│   └── src/
│       ├── index.ts           # Server entry
│       ├── db.ts              # SQLite database
│       ├── routes/            # API endpoints
│       └── services/          # Docker, update checker, Discord, scheduler, stats, resources, converter
├── web/             # React frontend (Vite + Tailwind)
│   └── src/
│       ├── App.tsx            # Router & app shell
│       ├── pages/             # Dashboard, StackEditor, Convert, Settings
│       └── components/        # StackCard, StatsPanel, ResourceModal, LogModal, DockerRunConverter
├── Dockerfile       # Multi-stage build
└── docker-compose.yml
```

## Migrating from Dockge

DockWatch uses the same directory structure as Dockge — migration is straightforward:

1. Your existing stacks in `/opt/stacks/` are automatically picked up
2. DockWatch reads both `compose.yaml` and `docker-compose.yml` (new stacks use `compose.yaml`)
3. Stop Dockge, start DockWatch — your stacks appear immediately

```bash
# Stop Dockge
cd /opt/dockge && docker compose down

# Start DockWatch (using the same /opt/stacks directory)
cd /opt/dockwatch && docker compose up -d
```

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stacks` | List all stacks with status |
| `GET` | `/api/stacks/:name` | Get stack compose content |
| `PUT` | `/api/stacks/:name` | Create/update stack |
| `DELETE` | `/api/stacks/:name` | Delete stack |
| `POST` | `/api/stacks/:name/up` | Start stack |
| `POST` | `/api/stacks/:name/down` | Stop stack |
| `POST` | `/api/stacks/:name/restart` | Restart stack |
| `POST` | `/api/stacks/:name/update` | Pull & recreate |
| `GET` | `/api/stacks/:name/logs` | Get logs |
| `GET` | `/api/stats` | Get host info plus live container stats |
| `POST` | `/api/convert` | Convert `docker run` command to Compose YAML |
| `GET` | `/api/resources/:name` | Get resource config for all services in a stack |
| `PUT` | `/api/resources/:name/:service` | Update resource config for one service |
| `GET` | `/api/updates` | Cached update status |
| `POST` | `/api/updates/check` | Trigger update check |
| `GET` | `/api/settings` | Get settings |
| `PUT` | `/api/settings` | Update settings |
| `POST` | `/api/settings/test-webhook` | Test Discord webhook |

## License

MIT
