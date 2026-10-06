import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify, parseEnv } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'yaml';

const execFileAsync = promisify(execFile);
const STACKS_DIR = process.env.DOCKWATCH_STACKS || '/opt/stacks';
const MAX_CONCURRENT_COMPOSE_OPS = Math.max(1, parseInt(process.env.DOCKWATCH_MAX_CONCURRENT_COMPOSE_OPS || '3', 10) || 3);
// Long-running operations (pull/up/down) get a generous ceiling so a hung registry or
// daemon can never block a compose slot and the per-stack lock forever.
const COMPOSE_TIMEOUT_MS = Math.max(10_000, parseInt(process.env.DOCKWATCH_COMPOSE_TIMEOUT_MS || '', 10) || 30 * 60_000);
const COMPOSE_QUICK_TIMEOUT_MS = 60_000;
const COMPOSE_KILL_GRACE_MS = 10_000;
const COMPOSE_FILE_NAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];
const ENV_FILE_NAME = '.env';

// Environment handed to `docker compose`. Compose gives the process environment
// precedence over the stack's .env file during interpolation, so passing DockWatch's
// own environment (PORT, NODE_ENV, ...) would silently override stack variables.
const PASSTHROUGH_ENV_KEYS = [
  'PATH',
  'HOME',
  'TZ',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'DOCKER_API_VERSION',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

export function getComposeProcessEnv(): Record<string, string> {
  const extra = String(process.env.DOCKWATCH_COMPOSE_ENV_PASSTHROUGH || '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));

  const env: Record<string, string> = {};
  for (const key of [...PASSTHROUGH_ENV_KEYS, ...extra]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

let composeRunning = 0;
const composeQueue: Array<() => void> = [];

async function acquireComposeSlot(): Promise<void> {
  if (composeRunning < MAX_CONCURRENT_COMPOSE_OPS) {
    composeRunning += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    composeQueue.push(() => {
      composeRunning += 1;
      resolve();
    });
  });
}

function releaseComposeSlot(): void {
  composeRunning = Math.max(0, composeRunning - 1);
  const next = composeQueue.shift();
  if (next) next();
}

// Serializes mutating operations per stack, so a scheduled auto-update and a manual
// action in the UI can never run `docker compose` against the same project at once.
const stackLocks = new Map<string, Promise<void>>();

export function isStackBusy(name: string): boolean {
  return stackLocks.has(name.toLowerCase());
}

async function withStackLock<T>(name: string, onChunk: ((chunk: string) => void) | undefined, fn: () => Promise<T>): Promise<T> {
  const key = name.toLowerCase();
  const previous = stackLocks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = (previous ?? Promise.resolve()).then(() => current);
  stackLocks.set(key, tail);

  if (previous) {
    onChunk?.(`[Dockwatch] Waiting for another operation on stack ${name} to finish...\n`);
    await previous;
  }

  try {
    return await fn();
  } finally {
    release();
    if (stackLocks.get(key) === tail) stackLocks.delete(key);
  }
}

export async function ensureStacksDir(): Promise<void> {
  await fs.mkdir(STACKS_DIR, { recursive: true });
}

export function stackDir(name: string): string {
  // Prevent path traversal
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe !== name) throw new Error(`Invalid stack name: ${name}`);
  return path.join(STACKS_DIR, safe);
}

async function findComposeFile(dir: string): Promise<string | null> {
  for (const fileName of COMPOSE_FILE_NAMES) {
    try {
      await fs.access(path.join(dir, fileName));
      return fileName;
    } catch { /* try next candidate */ }
  }
  return null;
}

export async function listStacks(): Promise<string[]> {
  await ensureStacksDir();
  const entries = await fs.readdir(STACKS_DIR, { withFileTypes: true });
  const stacks: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
    if (await findComposeFile(path.join(STACKS_DIR, entry.name))) {
      stacks.push(entry.name);
    }
  }
  return stacks.sort();
}

export async function stackExists(name: string): Promise<boolean> {
  return (await findComposeFile(stackDir(name))) !== null;
}

/** Resolve the compose file path — prefers compose.yaml, falls back to the other names compose accepts */
async function composeFile(name: string): Promise<string> {
  const dir = stackDir(name);
  const existing = await findComposeFile(dir);
  return path.join(dir, existing ?? 'compose.yaml');
}

export async function getComposeFileName(name: string): Promise<string> {
  return path.basename(await composeFile(name));
}

export async function getComposeContent(name: string): Promise<string> {
  const filePath = await composeFile(name);
  return fs.readFile(filePath, 'utf-8');
}

export async function saveComposeContent(name: string, content: string): Promise<void> {
  const dir = stackDir(name);
  await fs.mkdir(dir, { recursive: true });
  // Write back to the file the stack already uses (compose.yaml for new stacks), so a
  // legacy docker-compose.yml is never shadowed by a second, newer compose.yaml.
  await fs.writeFile(await composeFile(name), content, 'utf-8');
}

/** Read the stack's .env file. Returns null when the stack has none. */
export async function getEnvContent(name: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(stackDir(name), ENV_FILE_NAME), 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write the stack's .env file. New files are created with mode 600 because they
 * usually hold secrets; existing files keep their mode and owner. An empty value
 * never deletes an existing file, as compose files may reference it via env_file.
 */
export async function saveEnvContent(name: string, content: string): Promise<void> {
  const dir = stackDir(name);
  const target = path.join(dir, ENV_FILE_NAME);
  const exists = await fs.access(target).then(() => true, () => false);
  if (!exists && content.trim() === '') return;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(target, content, { encoding: 'utf-8', mode: 0o600 });
}

/** Parsed .env values of a stack (empty when there is no .env). */
export async function getStackEnv(name: string): Promise<Record<string, string>> {
  try {
    const content = await getEnvContent(name);
    if (!content) return {};
    return Object.fromEntries(
      Object.entries(parseEnv(content)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

/** Top-level entries of the stack folder besides the compose and .env files. */
export async function listExtraStackFiles(name: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(stackDir(name), { withFileTypes: true });
    return entries
      .filter((entry) => !COMPOSE_FILE_NAMES.includes(entry.name) && entry.name !== ENV_FILE_NAME)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort()
      .slice(0, 50);
  } catch {
    return [];
  }
}

export async function deleteStack(name: string): Promise<void> {
  const dir = stackDir(name);
  await withStackLock(name, undefined, async () => {
    // Stop first
    try { await runCompose(name, ['down']); } catch { /* might not be running */ }
    await fs.rm(dir, { recursive: true, force: true });
  });
}

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

async function runCompose(
  name: string,
  args: string[],
  onChunk?: (data: string) => void,
  timeoutMs = COMPOSE_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  const dir = stackDir(name);
  await acquireComposeSlot();

  return new Promise((resolve, reject) => {
    let slotReleased = false;
    const releaseOnce = () => {
      if (slotReleased) return;
      slotReleased = true;
      releaseComposeSlot();
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('docker', ['compose', '--ansi', 'always', ...args], {
        cwd: dir,
        env: { ...getComposeProcessEnv(), COMPOSE_PROJECT_NAME: name },
      });
    } catch (err) {
      releaseOnce();
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      onChunk?.(`\n[Dockwatch] docker compose ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s, stopping it...\n`);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), COMPOSE_KILL_GRACE_MS);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    };

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (onChunk) onChunk(chunk);
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (onChunk) onChunk(chunk);
    });

    child.on('close', (code) => {
      clearTimers();
      releaseOnce();
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
      } else {
        const reason = timedOut
          ? `docker compose ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`
          : `Command failed with exit code ${code}`;
        const error = new Error(`${reason}: ${stripAnsi(stderr).trim()}`);
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      }
    });

    child.on('error', (err) => {
      clearTimers();
      releaseOnce();
      reject(err);
    });
  });
}

export async function composeUp(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  return withStackLock(name, onChunk, async () => {
    const result = await runCompose(name, ['up', '-d', '--remove-orphans'], onChunk);
    return result.stdout + result.stderr;
  });
}

export async function composeDown(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  return withStackLock(name, onChunk, async () => {
    const result = await runCompose(name, ['down'], onChunk);
    return result.stdout + result.stderr;
  });
}

export async function composeRestart(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  return withStackLock(name, onChunk, async () => {
    const result = await runCompose(name, ['restart'], onChunk);
    return result.stdout + result.stderr;
  });
}

export async function composePull(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  return withStackLock(name, onChunk, async () => {
    const result = await runCompose(name, ['pull'], onChunk);
    return result.stdout + result.stderr;
  });
}

export async function composeLogs(name: string, tail = 100): Promise<string> {
  const result = await runCompose(name, ['logs', '--tail', String(tail), '--no-color'], undefined, COMPOSE_QUICK_TIMEOUT_MS);
  return result.stdout + result.stderr;
}

export async function composeContainerLogs(name: string, container: string, tail = 100): Promise<string> {
  const safeContainer = validateComposeServiceName(container);
  const result = await runCompose(name, ['logs', '--tail', String(tail), '--no-color', safeContainer], undefined, COMPOSE_QUICK_TIMEOUT_MS);
  return result.stdout + result.stderr;
}

/**
 * Run `docker compose config --quiet` for a saved stack and return what compose
 * reported (errors and warnings such as unset variables). Returns an empty list when
 * the file is valid and compose had nothing to say, or when docker is unavailable.
 */
export async function validateComposeConfig(name: string): Promise<string[]> {
  const toLines = (text: string) => stripAnsi(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);

  try {
    const result = await runCompose(name, ['config', '--quiet'], undefined, COMPOSE_QUICK_TIMEOUT_MS);
    return toLines(result.stderr);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    const lines = toLines(String(err?.stderr || err?.message || ''));
    return lines.length > 0 ? lines : ['docker compose config failed'];
  }
}

function isTrueLabel(value: unknown): boolean {
  return String(value).trim().toLowerCase() === 'true';
}

/** Read a boolean dockwatch label from a parsed compose service (list or map syntax). */
export function hasTrueLabel(labels: unknown, key: string): boolean {
  if (Array.isArray(labels)) {
    return labels.some((entry) => {
      if (typeof entry !== 'string') return false;
      const separator = entry.indexOf('=');
      if (separator < 0) return false;
      return entry.slice(0, separator).trim() === key && isTrueLabel(entry.slice(separator + 1));
    });
  }
  if (labels && typeof labels === 'object') {
    return isTrueLabel((labels as Record<string, unknown>)[key]);
  }
  return false;
}

/**
 * Scheduled auto-update for selected services of a stack: pull and recreate only the
 * services that are currently running and not excluded via `dockwatch.update.exclude`.
 * Stopped stacks and stopped services stay stopped.
 */
export async function composePullAndRecreate(
  name: string,
  services: string[],
  onChunk?: (chunk: string) => void,
): Promise<string> {
  return withStackLock(name, onChunk, async () => {
    const log = (line: string) => { onChunk?.(`${line}\n`); return `${line}\n`; };
    let output = '';

    const excluded = new Set<string>();
    try {
      const parsed = yaml.parse(await getComposeContent(name));
      for (const [svcName, svcConfig] of Object.entries((parsed?.services ?? {}) as Record<string, any>)) {
        if (hasTrueLabel(svcConfig?.labels, 'dockwatch.update.exclude')) excluded.add(svcName);
      }
    } catch (e: any) {
      output += log(`[Dockwatch] Error parsing compose file for update exclusions: ${e.message}`);
    }

    const running = new Set(
      (await runCompose(name, ['ps', '--services', '--status', 'running'], undefined, COMPOSE_QUICK_TIMEOUT_MS)).stdout
        .split('\n')
        .map((line) => stripAnsi(line).trim())
        .filter(Boolean),
    );

    const targets: string[] = [];
    for (const service of services) {
      if (!isValidComposeServiceName(service)) continue;
      if (excluded.has(service)) {
        output += log(`[Dockwatch] Skipping auto-update for excluded service: ${service}`);
      } else if (!running.has(service)) {
        output += log(`[Dockwatch] Skipping auto-update for service that is not running: ${service}`);
      } else {
        targets.push(service);
      }
    }

    if (targets.length === 0) {
      return output + log('[Dockwatch] No running, non-excluded services to update.');
    }

    const pullResult = await runCompose(name, ['pull', ...targets], onChunk);
    output += pullResult.stdout + pullResult.stderr + '\n';
    const upResult = await runCompose(name, ['up', '-d', '--no-deps', ...targets], onChunk);
    return output + upResult.stdout + upResult.stderr;
  });
}

/**
 * Manual stack update from UI: pull all images first, then `up -d` to recreate what
 * changed. Running containers keep serving if the pull fails.
 * This intentionally ignores dockwatch.update.exclude labels.
 */
export async function composeManualUpdate(name: string, onChunk?: (chunk: string) => void): Promise<string> {
  return withStackLock(name, onChunk, async () => {
    let output = '';

    if (onChunk) onChunk('[Dockwatch] Manual update: docker compose pull\n');
    const pullResult = await runCompose(name, ['pull'], onChunk);
    output += pullResult.stdout + pullResult.stderr + '\n';

    if (onChunk) onChunk('[Dockwatch] Manual update: docker compose up -d --remove-orphans\n');
    const upResult = await runCompose(name, ['up', '-d', '--remove-orphans'], onChunk);
    output += upResult.stdout + upResult.stderr;

    return output;
  });
}

export function isValidComposeServiceName(service: string): boolean {
  // Compose service / container names are alnum plus underscore, dash and dot,
  // and must start with an alphanumeric or underscore. Requiring a non-dash
  // first character prevents the value from being interpreted as a
  // `docker compose` CLI flag (e.g. `--no-log-prefix`) — argument-injection hardening.
  return /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(String(service || '').trim());
}

function validateComposeServiceName(service: string): string {
  const trimmed = String(service || '').trim();
  if (!isValidComposeServiceName(trimmed)) {
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
  return withStackLock(name, onChunk, async () => {
    let output = '';

    if (onChunk) onChunk(`[Dockwatch] Service update: docker compose pull ${safeService}\n`);
    const pullResult = await runCompose(name, ['pull', safeService], onChunk);
    output += pullResult.stdout + pullResult.stderr + '\n';

    if (onChunk) onChunk(`[Dockwatch] Service update: docker compose up -d --no-deps ${safeService}\n`);
    const upResult = await runCompose(name, ['up', '-d', '--no-deps', safeService], onChunk);
    output += upResult.stdout + upResult.stderr;

    return output;
  });
}

/** Get images used by running containers for a stack */
export async function getStackImages(name: string): Promise<string[]> {
  try {
    const result = await runCompose(name, ['config', '--images'], undefined, COMPOSE_QUICK_TIMEOUT_MS);
    return result.stdout.trim().split('\n').map((line) => stripAnsi(line).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * All repo digests of a local image (e.g. `nginx@sha256:...`), or null when the image
 * is not present locally. An image can carry digests of several repositories.
 */
export async function getImageRepoDigests(image: string): Promise<string[] | null> {
  try {
    const result = await execFileAsync('docker', [
      'image', 'inspect', image, '--format', '{{json .RepoDigests}}'
    ], { timeout: 15_000 });
    const parsed = JSON.parse(result.stdout.trim() || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return null;
  }
}

export interface StackContainer {
  Name: string;
  Service: string;
  State: string;
  Status: string;
  Health: string;
  Image: string;
  ExitCode: number | null;
}

export type StackStatus = 'running' | 'partial' | 'stopped' | 'unknown';

function healthFromStatus(status: string): string {
  if (status.includes('(unhealthy)')) return 'unhealthy';
  if (status.includes('(healthy)')) return 'healthy';
  if (status.includes('(health: starting)') || status.includes('(starting)')) return 'starting';
  return '';
}

function exitCodeFromStatus(status: string): number | null {
  const match = status.match(/^Exited \((-?\d+)\)/);
  return match ? Number(match[1]) : null;
}

/**
 * Containers of all compose projects, grouped by project name, from a single
 * `docker ps -a` call (instead of one `docker compose ps` per stack).
 */
export async function getContainersByProject(): Promise<Map<string, StackContainer[]>> {
  const format = [
    '{{.Names}}',
    '{{.State}}',
    '{{.Status}}',
    '{{.Image}}',
    '{{.Label "com.docker.compose.project"}}',
    '{{.Label "com.docker.compose.service"}}',
    '{{.Label "com.docker.compose.oneoff"}}',
  ].join('\t');
  const { stdout } = await execFileAsync('docker', [
    'ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', format,
  ], { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 });

  const byProject = new Map<string, StackContainer[]>();
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [names = '', state = '', status = '', image = '', project = '', service = '', oneoff = ''] = line.split('\t');
    if (!project || oneoff.trim().toLowerCase() === 'true') continue;
    const container: StackContainer = {
      Name: names.split(',')[0],
      Service: service,
      State: state,
      Status: status,
      Health: healthFromStatus(status),
      Image: image,
      ExitCode: exitCodeFromStatus(status),
    };
    const key = project.toLowerCase();
    const list = byProject.get(key) ?? [];
    list.push(container);
    byProject.set(key, list);
  }

  for (const list of byProject.values()) {
    list.sort((a, b) => a.Service.localeCompare(b.Service) || a.Name.localeCompare(b.Name));
  }
  return byProject;
}

/**
 * Stack status from its containers. Containers that exited cleanly (exit code 0,
 * e.g. one-shot init jobs) do not degrade an otherwise running stack.
 */
export function computeStackStatus(containers: Pick<StackContainer, 'State' | 'ExitCode'>[]): StackStatus {
  const running = containers.filter((c) => c.State === 'running');
  if (running.length === 0) return 'stopped';
  const degraded = containers.some((c) => c.State !== 'running' && !(c.State === 'exited' && c.ExitCode === 0));
  return degraded ? 'partial' : 'running';
}
