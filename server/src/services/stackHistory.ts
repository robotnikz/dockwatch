import fs from 'node:fs/promises';
import path from 'node:path';

// Previous versions of compose/.env files, written before every save from the UI.
// Stored in the data directory (mode 600), because .env files usually hold secrets.
const MAX_VERSIONS_PER_STACK = 20;
const VERSION_ID_PATTERN = /^\d{8}T\d{9}Z(?:-\d{1,3})?$/;

export interface StackVersion {
  id: string;
  savedAt: string;
  hasEnv: boolean;
}

export interface StackSnapshot {
  content: string;
  env: string | null;
}

function historyRoot(): string {
  return path.join(process.env.DOCKWATCH_DATA || '/app/data', 'history');
}

function historyDir(stackName: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(stackName)) throw new Error(`Invalid stack name: ${stackName}`);
  return path.join(historyRoot(), stackName);
}

function assertVersionId(id: string): void {
  if (!VERSION_ID_PATTERN.test(id)) throw new Error(`Invalid version id: ${id}`);
}

function idToIso(id: string): string {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : id;
}

function newVersionId(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, '');
}

export async function listStackHistory(stackName: string): Promise<StackVersion[]> {
  let files: string[];
  try {
    files = await fs.readdir(historyDir(stackName));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }

  const versions = new Map<string, StackVersion>();
  for (const file of files) {
    const match = file.match(/^(.+)\.(compose|env)$/);
    if (!match || !VERSION_ID_PATTERN.test(match[1])) continue;
    const entry = versions.get(match[1]) ?? { id: match[1], savedAt: idToIso(match[1]), hasEnv: false };
    if (match[2] === 'env') entry.hasEnv = true;
    versions.set(match[1], entry);
  }
  return [...versions.values()]
    .filter((v) => files.includes(`${v.id}.compose`))
    .sort((a, b) => b.id.localeCompare(a.id));
}

export async function getStackHistoryVersion(stackName: string, id: string): Promise<StackSnapshot> {
  assertVersionId(id);
  const dir = historyDir(stackName);
  const content = await fs.readFile(path.join(dir, `${id}.compose`), 'utf-8');
  let env: string | null = null;
  try {
    env = await fs.readFile(path.join(dir, `${id}.env`), 'utf-8');
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  return { content, env };
}

/**
 * Store the current state of a stack as a version, unless it equals the newest stored
 * version. Old versions beyond the per-stack limit are pruned.
 */
export async function snapshotStack(stackName: string, snapshot: StackSnapshot, now = new Date()): Promise<void> {
  const dir = historyDir(stackName);
  const versions = await listStackHistory(stackName);
  if (versions.length > 0) {
    const latest = await getStackHistoryVersion(stackName, versions[0].id);
    if (latest.content === snapshot.content && latest.env === snapshot.env) return;
  }

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  let id = newVersionId(now);
  for (let n = 1; versions.some((v) => v.id === id); n += 1) {
    id = `${newVersionId(now)}-${n}`;
  }
  await fs.writeFile(path.join(dir, `${id}.compose`), snapshot.content, { encoding: 'utf-8', mode: 0o600 });
  if (snapshot.env !== null) {
    await fs.writeFile(path.join(dir, `${id}.env`), snapshot.env, { encoding: 'utf-8', mode: 0o600 });
  }

  const all = await listStackHistory(stackName);
  for (const old of all.slice(MAX_VERSIONS_PER_STACK)) {
    await fs.rm(path.join(dir, `${old.id}.compose`), { force: true });
    await fs.rm(path.join(dir, `${old.id}.env`), { force: true });
  }
}

export async function deleteStackHistory(stackName: string): Promise<void> {
  await fs.rm(historyDir(stackName), { recursive: true, force: true });
}
