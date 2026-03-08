import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'yaml';

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

async function runCompose(name: string, args: string[], onChunk?: (data: string) => void): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const dir = stackDir(name);
    const child = spawn('docker', ['compose', '--ansi', 'always', ...args], {
      cwd: dir,
      env: { ...process.env, COMPOSE_PROJECT_NAME: name },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (onChunk) onChunk(chunk);
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (onChunk) onChunk(chunk);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed with exit code ${code}: ${stderr}`);
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      }
    });

    child.on('error', reject);
  });
}

export async function composeUp(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  const result = await runCompose(name, ['up', '-d', '--remove-orphans'], onChunk);
  return result.stdout + result.stderr;
}

export async function composeDown(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  const result = await runCompose(name, ['down'], onChunk);
  return result.stdout + result.stderr;
}

export async function composeRestart(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  const result = await runCompose(name, ['restart'], onChunk);
  return result.stdout + result.stderr;
}

export async function composePull(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  const result = await runCompose(name, ['pull'], onChunk);
  return result.stdout + result.stderr;
}

export async function composeLogs(name: string, tail = 100): Promise<string> {
  const result = await runCompose(name, ['logs', '--tail', String(tail)]);
  return result.stdout + result.stderr;
}

export async function composePs(name: string): Promise<string> {
  const result = await runCompose(name, ['ps', '--format', 'json']);
  return result.stdout;
}

export async function composePullAndRecreate(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  let servicesToPull: string[] = [];
  try {
    const yamlContent = await fs.readFile(path.join(stackDir(name), 'compose.yaml'), 'utf-8');
    const parsed = yaml.parse(yamlContent);
    if (parsed && typeof parsed === 'object' && parsed.services) {
      for (const [svcName, svcConfig] of Object.entries(parsed.services)) {
        const config = svcConfig as any;
        let exclude = false;
        if (config.labels) {
          if (Array.isArray(config.labels)) {
            exclude = config.labels.some((l: string) => l.startsWith('dockwatch.update.exclude=') && l.split('=')[1].trim() === 'true');
          } else if (typeof config.labels === 'object') {
            exclude = config.labels['dockwatch.update.exclude'] === 'true' || config.labels['dockwatch.update.exclude'] === true;
          }
        }
        if (!exclude) {
          servicesToPull.push(svcName);
        } else if (onChunk) {
          onChunk(`[Dockwatch] Skipping auto-update pull for excluded service: ${svcName}\n`);
        }
      }
    }
  } catch (e: any) {
    if (onChunk) onChunk(`[Dockwatch] Error parsing compose.yaml for update exclusions: ${e.message}\n`);
  }

  // If no services to pull because all are excluded, we just run up
  let pullOutput = '';
  if (servicesToPull.length > 0) {
    const pullResult = await runCompose(name, ['pull', ...servicesToPull], onChunk);
    pullOutput = pullResult.stdout + pullResult.stderr + '\n';
  } else if (onChunk) {
    onChunk('[Dockwatch] No services to pull (all are excluded or no services found).\n');
  }

  // Up still recreate containers if needed, but it checks if image changed. If not pulled, it won't be recreated normally unless yaml changed.
  const upResult = await runCompose(name, ['up', '-d', '--remove-orphans'], onChunk);
  return pullOutput + upResult.stdout + upResult.stderr;
}

/**
 * Manual stack update from UI: always do down -> pull -> up -d for all services.
 * This intentionally ignores dockwatch.update.exclude labels.
 */
export async function composeManualUpdate(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  let output = '';

  if (onChunk) onChunk('[Dockwatch] Manual update: docker compose down\n');
  const downResult = await runCompose(name, ['down'], onChunk);
  output += downResult.stdout + downResult.stderr + '\n';

  if (onChunk) onChunk('[Dockwatch] Manual update: docker compose pull\n');
  const pullResult = await runCompose(name, ['pull'], onChunk);
  output += pullResult.stdout + pullResult.stderr + '\n';

  if (onChunk) onChunk('[Dockwatch] Manual update: docker compose up -d\n');
  const upResult = await runCompose(name, ['up', '-d', '--remove-orphans'], onChunk);
  output += upResult.stdout + upResult.stderr;

  return output;
}

function validateComposeServiceName(service: string): string {
  const trimmed = String(service || '').trim();
  // Compose service keys are typically alnum plus underscore, dash, and dot.
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    throw new Error(`Invalid service name: ${service}`);
  }
  return trimmed;
}

/**
 * Manual service update from UI: pull + recreate one service only.
 * Keeps other services untouched and avoids full-stack downtime.
 */
export async function composeManualUpdateService(
  name: string,
  service: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const safeService = validateComposeServiceName(service);
  let output = '';

  if (onChunk) onChunk(`[Dockwatch] Service update (${safeService}): docker compose pull ${safeService}\n`);
  const pullResult = await runCompose(name, ['pull', safeService], onChunk);
  output += pullResult.stdout + pullResult.stderr + '\n';

  if (onChunk) onChunk(`[Dockwatch] Service update (${safeService}): docker compose up -d --no-deps ${safeService}\n`);
  const upResult = await runCompose(name, ['up', '-d', '--no-deps', safeService], onChunk);
  output += upResult.stdout + upResult.stderr;

  return output;
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
