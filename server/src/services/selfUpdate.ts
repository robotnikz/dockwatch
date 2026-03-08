import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UPDATE_DIR = path.resolve(__dirname, '../../..');

export interface SelfUpdateInfo {
  enabled: boolean;
  supported: boolean;
  workingDir: string;
  composeFile: string | null;
  reason?: string;
}

function resolveWorkingDir(): string {
  const configured = String(process.env.DOCKWATCH_SELF_UPDATE_DIR || '').trim();
  return configured || DEFAULT_UPDATE_DIR;
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
  const workingDir = resolveWorkingDir();

  if (!enabled) {
    return {
      enabled,
      supported: false,
      workingDir,
      composeFile: null,
      reason: 'Self-update disabled by environment',
    };
  }

  const composeFile = resolveComposeFile(workingDir);
  if (!composeFile) {
    return {
      enabled,
      supported: false,
      workingDir,
      composeFile: null,
      reason: 'No compose file found in self-update directory',
    };
  }

  return {
    enabled,
    supported: true,
    workingDir,
    composeFile,
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
