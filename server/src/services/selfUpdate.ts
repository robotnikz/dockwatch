import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UPDATE_DIR = '/opt/dockwatch';
const DEV_FALLBACK_UPDATE_DIR = path.resolve(__dirname, '../../..');
const STACKS_DIR = String(process.env.DOCKWATCH_STACKS || '/opt/stacks').trim() || '/opt/stacks';

export interface SelfUpdateInfo {
  enabled: boolean;
  supported: boolean;
  workingDir: string;
  composeFile: string | null;
  reason?: string;
}

function getCandidateWorkingDirs(): string[] {
  const configured = String(process.env.DOCKWATCH_SELF_UPDATE_DIR || '').trim();
  const candidates = [
    configured,
    DEFAULT_UPDATE_DIR,
    DEV_FALLBACK_UPDATE_DIR,
    path.join(STACKS_DIR, 'dockwatch'),
    '/opt/stacks/dockwatch',
  ].filter(Boolean);

  const uniq = new Set<string>();
  for (const candidate of candidates) {
    uniq.add(path.resolve(candidate));
  }
  return [...uniq];
}

function resolveComposeFile(dir: string): string | null {
  const candidates = ['docker-compose.yml', 'compose.yaml', 'compose.yml'];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return null;
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
    reason: `No compose file found in candidates: ${dirs.join(', ')}`,
  };
}

export function triggerSelfUpdate(): { accepted: boolean; reloadAfterSeconds: number } {
  const info = getSelfUpdateInfo();
  if (!info.supported || !info.composeFile) {
    throw new Error(info.reason || 'Self-update is not available');
  }

  const cmd = [
    'sleep 1',
    'docker compose down',
    'docker compose pull',
    'docker compose up -d',
  ].join(' && ');

  const child = spawn('sh', ['-lc', cmd], {
    cwd: info.workingDir,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { accepted: true, reloadAfterSeconds: 30 };
}
