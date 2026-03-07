import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const STACKS_DIR = process.env.DOCKWATCH_STACKS || '/opt/stacks';

export async function ensureStacksDir(): Promise<void> {
  await fs.mkdir(STACKS_DIR, { recursive: true });
}

export function stackDir(name: string): string {
  // Prevent path traversal
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe !== name) throw new Error(`Invalid stack name: ${name}`);
  return path.join(STACKS_DIR, safe);
}

export async function listStacks(): Promise<string[]> {
  await ensureStacksDir();
  const entries = await fs.readdir(STACKS_DIR, { withFileTypes: true });
  const stacks: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Support both compose.yaml (preferred) and docker-compose.yml (legacy)
      const composeYaml = path.join(STACKS_DIR, entry.name, 'compose.yaml');
      const composeLegacy = path.join(STACKS_DIR, entry.name, 'docker-compose.yml');
      try {
        await fs.access(composeYaml);
        stacks.push(entry.name);
      } catch {
        try {
          await fs.access(composeLegacy);
          stacks.push(entry.name);
        } catch { /* skip dirs without compose file */ }
      }
    }
  }
  return stacks.sort();
}

/** Resolve the compose file path — prefers compose.yaml, falls back to docker-compose.yml */
async function composeFile(name: string): Promise<string> {
  const dir = stackDir(name);
  const primary = path.join(dir, 'compose.yaml');
  try {
    await fs.access(primary);
    return primary;
  } catch {
    const legacy = path.join(dir, 'docker-compose.yml');
    try {
      await fs.access(legacy);
      return legacy;
    } catch {
      return primary; // default to compose.yaml for new stacks
    }
  }
}

export async function getComposeContent(name: string): Promise<string> {
  const filePath = await composeFile(name);
  return fs.readFile(filePath, 'utf-8');
}

export async function saveComposeContent(name: string, content: string): Promise<void> {
  const dir = stackDir(name);
  await fs.mkdir(dir, { recursive: true });
  // Always save as compose.yaml (modern convention)
  await fs.writeFile(path.join(dir, 'compose.yaml'), content, 'utf-8');
}

export async function deleteStack(name: string): Promise<void> {
  const dir = stackDir(name);
  // Stop first
  try { await composeDown(name); } catch { /* might not be running */ }
  await fs.rm(dir, { recursive: true, force: true });
}

async function runCompose(name: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const dir = stackDir(name);
  return execFileAsync('docker', ['compose', ...args], {
    cwd: dir,
    timeout: 120_000,
    env: { ...process.env, COMPOSE_PROJECT_NAME: name },
  });
}

export async function composeUp(name: string): Promise<string> {
  const result = await runCompose(name, ['up', '-d', '--remove-orphans']);
  return result.stdout + result.stderr;
}

export async function composeDown(name: string): Promise<string> {
  const result = await runCompose(name, ['down']);
  return result.stdout + result.stderr;
}

export async function composeRestart(name: string): Promise<string> {
  const result = await runCompose(name, ['restart']);
  return result.stdout + result.stderr;
}

export async function composePull(name: string): Promise<string> {
  const result = await runCompose(name, ['pull']);
  return result.stdout + result.stderr;
}

export async function composeLogs(name: string, tail = 100): Promise<string> {
  const result = await runCompose(name, ['logs', '--tail', String(tail), '--no-color']);
  return result.stdout + result.stderr;
}

export async function composePs(name: string): Promise<string> {
  const result = await runCompose(name, ['ps', '--format', 'json']);
  return result.stdout;
}

export async function composePullAndRecreate(name: string): Promise<string> {
  const pullResult = await runCompose(name, ['pull']);
  const upResult = await runCompose(name, ['up', '-d', '--remove-orphans']);
  return pullResult.stdout + pullResult.stderr + '\n' + upResult.stdout + upResult.stderr;
}

/** Get images used by running containers for a stack */
export async function getStackImages(name: string): Promise<string[]> {
  try {
    const result = await runCompose(name, ['config', '--images']);
    return result.stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Get local image digest */
export async function getLocalDigest(image: string): Promise<string | null> {
  try {
    const result = await execFileAsync('docker', [
      'image', 'inspect', image, '--format', '{{index .RepoDigests 0}}'
    ], { timeout: 15_000 });
    const digest = result.stdout.trim();
    // Extract sha256:xxx from image@sha256:xxx
    const match = digest.match(/@(sha256:[a-f0-9]+)/);
    return match ? match[1] : digest;
  } catch {
    return null;
  }
}
