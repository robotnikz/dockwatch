import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UPDATE_DIR = '/opt/dockwatch';
const DEV_FALLBACK_UPDATE_DIR = path.resolve(__dirname, '../../..');
const STACKS_DIR = String(process.env.DOCKWATCH_STACKS || '/opt/stacks').trim() || '/opt/stacks';
const DATA_DIR = String(process.env.DOCKWATCH_DATA || '').trim();
const COMPOSE_FILE_CANDIDATES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'];
const UPDATE_LOCK_FILE = path.join(os.tmpdir(), 'dockwatch-self-update.lock');
const UPDATE_LOCK_STALE_MS = 15 * 60 * 1000;

export interface SelfUpdateInfo {
  enabled: boolean;
  supported: boolean;
  workingDir: string;
  composeFile: string | null;
  reason?: string;
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

function getComposeDebugSummary(dirs: string[]): string {
  return dirs
    .map((dir) => {
      const matches = COMPOSE_FILE_CANDIDATES.filter((file) => fs.existsSync(path.join(dir, file)));
      if (matches.length > 0) {
        return `${dir} (found: ${matches.join(', ')})`;
      }
      return `${dir} (checked: ${COMPOSE_FILE_CANDIDATES.join(', ')})`;
    })
    .join('; ');
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

export function getSelfUpdateInfo(): SelfUpdateInfo {
  const enabled = String(process.env.DOCKWATCH_SELF_UPDATE_ENABLED || 'true').trim().toLowerCase() !== 'false';
  const dirs = getCandidateWorkingDirs();

  if (!enabled) {
    return {
      enabled,
      supported: false,
      workingDir: dirs[0] || DEFAULT_UPDATE_DIR,
      composeFile: null,
      reason: 'Self-update disabled by environment',
    };
  }

  for (const workingDir of dirs) {
    const composeFile = resolveComposeFile(workingDir);
    if (composeFile) {
      return {
        enabled,
        supported: true,
        workingDir,
        composeFile,
      };
    }
  }

  if (dirs.length === 0) {
    return {
      enabled,
      supported: false,
      workingDir: DEFAULT_UPDATE_DIR,
      composeFile: null,
      reason: 'No self-update directories available',
    };
  }

  return {
    enabled,
    supported: false,
    workingDir: dirs[0],
    composeFile: null,
    reason: `No compose file found in candidates: ${dirs.join(', ')}. Details: ${getComposeDebugSummary(dirs)}`,
  };
}

export function triggerSelfUpdate(): { accepted: boolean; reloadAfterSeconds: number } {
  const info = getSelfUpdateInfo();
  if (!info.supported || !info.composeFile) {
    throw new Error(info.reason || 'Self-update is not available');
  }

  const composePath = path.join(info.workingDir, info.composeFile);
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

  return { accepted: true, reloadAfterSeconds: 30 };
}
