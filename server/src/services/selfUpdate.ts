import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UPDATE_DIR = '/opt/dockwatch';
const DEV_FALLBACK_UPDATE_DIR = path.resolve(__dirname, '../../..');
const STACKS_DIR = String(process.env.DOCKWATCH_STACKS || '/opt/stacks').trim() || '/opt/stacks';
const DATA_DIR = String(process.env.DOCKWATCH_DATA || '').trim();
const COMPOSE_FILE_CANDIDATES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'];
const UPDATE_LOCK_FILE = path.join(os.tmpdir(), 'dockwatch-self-update.lock');
const UPDATE_LOCK_STALE_MS = 15 * 60 * 1000;
const HELPER_CONTAINER_NAME = 'dockwatch-self-update';
const DOCKER_SOCKET = '/var/run/docker.sock';

export interface SelfUpdateInfo {
  enabled: boolean;
  supported: boolean;
  /**
   * helper: DockWatch runs in a compose-managed container; a short-lived helper container
   *         pulls and recreates it (the update must not run inside the container it replaces).
   * local:  DockWatch runs directly on the host next to its compose file.
   */
  mode: 'helper' | 'local' | null;
  workingDir: string;
  composeFile: string | null;
  reason?: string;
}

interface OwnContainer {
  image: string;
  project: string;
  service: string;
  workingDir: string;
  configFiles: string[];
  socketSource: string | null;
}

function runDocker(args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr || err.message).trim()));
        return;
      }
      resolve(String(stdout));
    });
  });
}

/** ID of the container DockWatch runs in, or null when it runs directly on a host. */
export function detectOwnContainerId(): string | null {
  try {
    // Docker bind-mounts /etc/hostname from /var/lib/docker/containers/<id>/hostname.
    const mountinfo = fs.readFileSync('/proc/self/mountinfo', 'utf-8');
    const match = mountinfo.match(/\/containers\/([0-9a-f]{64})\/hostname \/etc\/hostname /);
    if (match) return match[1];
  } catch {
    // Not on Linux or no procfs.
  }

  if (!fs.existsSync('/.dockerenv')) return null;
  const hostname = os.hostname();
  return /^[0-9a-f]{12,64}$/.test(hostname) ? hostname : null;
}

let ownContainerCache: OwnContainer | null = null;

async function inspectOwnContainer(containerId: string): Promise<OwnContainer> {
  if (ownContainerCache) return ownContainerCache;

  const raw = JSON.parse(await runDocker(['inspect', containerId, '--format', '{{json .}}']));
  const labels: Record<string, string> = raw?.Config?.Labels ?? {};
  const mounts: Array<{ Source?: string; Destination?: string }> = Array.isArray(raw?.Mounts) ? raw.Mounts : [];
  const own: OwnContainer = {
    image: String(raw?.Image || ''),
    project: String(labels['com.docker.compose.project'] || ''),
    service: String(labels['com.docker.compose.service'] || ''),
    workingDir: String(labels['com.docker.compose.project.working_dir'] || ''),
    configFiles: String(labels['com.docker.compose.project.config_files'] || '')
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean),
    socketSource: mounts.find((mount) => mount.Destination === DOCKER_SOCKET)?.Source || null,
  };
  ownContainerCache = own;
  return own;
}

function getCandidateWorkingDirs(): string[] {
  const configured = String(process.env.DOCKWATCH_SELF_UPDATE_DIR || '').trim();
  const dataParent = DATA_DIR ? path.dirname(DATA_DIR) : '';
  const candidates = [
    configured,
    DEFAULT_UPDATE_DIR,
    dataParent,
    process.cwd(),
    DEV_FALLBACK_UPDATE_DIR,
    path.join(STACKS_DIR, 'dockwatch'),
    '/opt/stacks/dockwatch',
  ].filter(Boolean);

  const uniq = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    uniq.add(resolved);
    try {
      uniq.add(fs.realpathSync(resolved));
    } catch {
      // Ignore non-existing/unresolvable paths here.
    }
  }
  return [...uniq];
}

function resolveComposeFile(dir: string): string | null {
  for (const candidate of COMPOSE_FILE_CANDIDATES) {
    if (fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return null;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isStaleLock(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > UPDATE_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function acquireUpdateLock(lockPath: string): void {
  if (fs.existsSync(lockPath) && isStaleLock(lockPath)) {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore stale lock cleanup errors and try to acquire lock anyway.
    }
  }

  let fd: number;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err: any) {
    if (err?.code === 'EEXIST') {
      throw new Error('Self-update already running');
    }
    throw new Error(`Failed to acquire self-update lock: ${err?.message || 'unknown error'}`);
  }

  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } finally {
    fs.closeSync(fd);
  }
}

function assertDockerComposeAvailable(): void {
  const result = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error('docker compose is not available on this host');
  }
}

function getLocalSelfUpdateInfo(enabled: boolean): SelfUpdateInfo {
  const dirs = getCandidateWorkingDirs();
  for (const workingDir of dirs) {
    const composeFile = resolveComposeFile(workingDir);
    if (composeFile) {
      return { enabled, supported: true, mode: 'local', workingDir, composeFile };
    }
  }

  return {
    enabled,
    supported: false,
    mode: null,
    workingDir: dirs[0] || DEFAULT_UPDATE_DIR,
    composeFile: null,
    reason: `No compose file found in candidates: ${dirs.join(', ')}`,
  };
}

export async function getSelfUpdateInfo(): Promise<SelfUpdateInfo> {
  const enabled = String(process.env.DOCKWATCH_SELF_UPDATE_ENABLED || 'true').trim().toLowerCase() !== 'false';
  if (!enabled) {
    return {
      enabled,
      supported: false,
      mode: null,
      workingDir: DEFAULT_UPDATE_DIR,
      composeFile: null,
      reason: 'Self-update disabled by environment',
    };
  }

  const containerId = detectOwnContainerId();
  if (!containerId) return getLocalSelfUpdateInfo(enabled);

  const unsupported = (reason: string, workingDir = DEFAULT_UPDATE_DIR): SelfUpdateInfo => ({
    enabled, supported: false, mode: null, workingDir, composeFile: null, reason,
  });

  let own: OwnContainer;
  try {
    own = await inspectOwnContainer(containerId);
  } catch (err: any) {
    return unsupported(`Cannot inspect the DockWatch container: ${err?.message || 'unknown error'}`);
  }
  if (!own.project || !own.service || !own.workingDir) {
    return unsupported('DockWatch was not started with docker compose. Update it with your own tooling.');
  }
  if (!own.socketSource) {
    return unsupported(`Self-update needs the Docker socket mounted at ${DOCKER_SOCKET}.`, own.workingDir);
  }
  return {
    enabled,
    supported: true,
    mode: 'helper',
    workingDir: own.workingDir,
    composeFile: own.configFiles.join(', ') || null,
  };
}

async function triggerHelperSelfUpdate(own: OwnContainer): Promise<void> {
  const composeArgs = [
    'compose',
    '-p', own.project,
    '--project-directory', own.workingDir,
    ...own.configFiles.flatMap((file) => ['-f', file]),
  ].map(shQuote).join(' ');
  const service = shQuote(own.service);
  const script = [
    'set -e',
    'sleep 2',
    `docker ${composeArgs} pull ${service}`,
    `docker ${composeArgs} up -d --no-deps ${service}`,
  ].join('; ');

  // The helper needs the compose project files at their host paths (read-only).
  const mountDirs = new Set([own.workingDir, ...own.configFiles.map((file) => path.dirname(file))]);
  const args = [
    'run', '-d', '--rm',
    '--name', HELPER_CONTAINER_NAME,
    '--label', 'dockwatch.helper=self-update',
    '-v', `${own.socketSource}:${DOCKER_SOCKET}`,
    ...[...mountDirs].flatMap((dir) => ['-v', `${dir}:${dir}:ro`]),
    '-w', own.workingDir,
    '--entrypoint', 'sh',
    // The current image already ships the docker CLI with the compose plugin.
    own.image,
    '-c', script,
  ];

  try {
    await runDocker(args, 60_000);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (/already in use|Conflict/i.test(message)) {
      throw new Error('Self-update already running');
    }
    throw new Error(`Failed to start self-update helper: ${message || 'unknown error'}`);
  }
}

function triggerLocalSelfUpdate(info: SelfUpdateInfo): void {
  const composePath = path.join(info.workingDir, info.composeFile as string);
  if (!fs.existsSync(composePath)) {
    throw new Error(`Compose file not found: ${composePath}`);
  }

  assertDockerComposeAvailable();
  acquireUpdateLock(UPDATE_LOCK_FILE);

  const cmd = [
    'set -eu',
    `lock_file=${shQuote(UPDATE_LOCK_FILE)}`,
    'cleanup() { rm -f "$lock_file"; }',
    'trap cleanup EXIT INT TERM',
    'sleep 1',
    `docker compose -f ${shQuote(composePath)} pull`,
    `docker compose -f ${shQuote(composePath)} up -d --remove-orphans`,
  ].join('; ');

  try {
    const child = spawn('sh', ['-lc', cmd], {
      cwd: info.workingDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err: any) {
    try {
      fs.unlinkSync(UPDATE_LOCK_FILE);
    } catch {
      // Ignore lock cleanup errors and bubble the original spawn error.
    }
    throw new Error(`Failed to start self-update process: ${err?.message || 'unknown error'}`);
  }
}

export async function triggerSelfUpdate(): Promise<{ accepted: boolean; reloadAfterSeconds: number }> {
  const info = await getSelfUpdateInfo();
  if (!info.supported) {
    throw new Error(info.reason || 'Self-update is not available');
  }

  if (info.mode === 'helper') {
    const containerId = detectOwnContainerId();
    if (!containerId) throw new Error('Self-update is not available');
    await triggerHelperSelfUpdate(await inspectOwnContainer(containerId));
  } else {
    triggerLocalSelfUpdate(info);
  }

  return { accepted: true, reloadAfterSeconds: 30 };
}
