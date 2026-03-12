import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

import type BetterSqlite3 from 'better-sqlite3';

const DATA_DIR = process.env.DOCKWATCH_DATA || '/app/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const db: BetterSqlite3.Database = new Database(path.join(DATA_DIR, 'dockwatch.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stacks (
    name       TEXT PRIMARY KEY,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS update_cache (
    image       TEXT PRIMARY KEY,
    local_digest  TEXT,
    remote_digest TEXT,
    context     TEXT,
    checked_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Simple migration to add 'context' column if it doesn't exist
const tableInfo = db.prepare("PRAGMA table_info(update_cache)").all() as any[];
if (!tableInfo.some(col => col.name === 'context')) {
  db.exec("ALTER TABLE update_cache ADD COLUMN context TEXT;");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS cleanup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reason TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    reclaimed_bytes INTEGER NOT NULL DEFAULT 0,
    deleted_containers INTEGER NOT NULL DEFAULT 0,
    deleted_images INTEGER NOT NULL DEFAULT 0,
    deleted_networks INTEGER NOT NULL DEFAULT 0,
    deleted_volumes INTEGER NOT NULL DEFAULT 0,
    deleted_build_cache INTEGER NOT NULL DEFAULT 0,
    success INTEGER NOT NULL DEFAULT 1,
    error TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduler_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    scope TEXT,
    level TEXT NOT NULL DEFAULT 'error',
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function registerStack(name: string, stackPath: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO stacks (name, path, updated_at) VALUES (?, ?, datetime('now'))`
  ).run(name, stackPath);
}

export function removeStack(name: string): void {
  db.prepare('DELETE FROM stacks WHERE name = ?').run(name);
}

export function getStacks(): { name: string; path: string }[] {
  return db.prepare('SELECT name, path FROM stacks ORDER BY name').all() as { name: string; path: string }[];
}

export function setUpdateCache(image: string, localDigest: string | null, remoteDigest: string | null, context?: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO update_cache (image, local_digest, remote_digest, context, checked_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(image, localDigest, remoteDigest, context || null);
}

export function getUpdateCache(image: string): { local_digest: string | null; remote_digest: string | null; context: string | null; checked_at: string } | undefined {
  return db.prepare('SELECT local_digest, remote_digest, context, checked_at FROM update_cache WHERE image = ?').get(image) as any;
}

export function getAllUpdateCache(): { image: string; local_digest: string | null; remote_digest: string | null; context: string | null; checked_at: string }[] {
  return db.prepare('SELECT * FROM update_cache ORDER BY image').all() as any[];
}

export interface CleanupRunRecord {
  reason: string;
  started_at: string;
  finished_at: string;
  reclaimed_bytes: number;
  deleted_containers: number;
  deleted_images: number;
  deleted_networks: number;
  deleted_volumes: number;
  deleted_build_cache: number;
  success: boolean;
  error?: string | null;
}

export function insertCleanupRun(record: CleanupRunRecord): void {
  db.prepare(
    `INSERT INTO cleanup_runs (
      reason, started_at, finished_at, reclaimed_bytes,
      deleted_containers, deleted_images, deleted_networks, deleted_volumes, deleted_build_cache,
      success, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.reason,
    record.started_at,
    record.finished_at,
    record.reclaimed_bytes,
    record.deleted_containers,
    record.deleted_images,
    record.deleted_networks,
    record.deleted_volumes,
    record.deleted_build_cache,
    record.success ? 1 : 0,
    record.error || null,
  );
}

export function getCleanupSummary(): {
  prune_runs: number;
  failed_runs: number;
  total_reclaimed_bytes: number;
  deleted_containers: number;
  deleted_images: number;
  deleted_networks: number;
  deleted_volumes: number;
  deleted_build_cache: number;
  first_run_at: string | null;
  last_run_at: string | null;
} {
  return db.prepare(
    `SELECT
      COUNT(*) AS prune_runs,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed_runs,
      COALESCE(SUM(reclaimed_bytes), 0) AS total_reclaimed_bytes,
      COALESCE(SUM(deleted_containers), 0) AS deleted_containers,
      COALESCE(SUM(deleted_images), 0) AS deleted_images,
      COALESCE(SUM(deleted_networks), 0) AS deleted_networks,
      COALESCE(SUM(deleted_volumes), 0) AS deleted_volumes,
      COALESCE(SUM(deleted_build_cache), 0) AS deleted_build_cache,
      MIN(started_at) AS first_run_at,
      MAX(started_at) AS last_run_at
     FROM cleanup_runs`
  ).get() as any;
}

export function getLatestCleanupRun(): {
  id: number;
  reason: string;
  started_at: string;
  finished_at: string;
  reclaimed_bytes: number;
  deleted_containers: number;
  deleted_images: number;
  deleted_networks: number;
  deleted_volumes: number;
  deleted_build_cache: number;
  success: number;
  error: string | null;
} | undefined {
  return db.prepare('SELECT * FROM cleanup_runs ORDER BY id DESC LIMIT 1').get() as any;
}

export function clearCleanupRuns(): void {
  db.prepare('DELETE FROM cleanup_runs').run();
}

export interface SchedulerEventRecord {
  category: string;
  scope?: string | null;
  level?: 'info' | 'warn' | 'error';
  message: string;
}

export function insertSchedulerEvent(record: SchedulerEventRecord): void {
  db.prepare(
    `INSERT INTO scheduler_events (category, scope, level, message)
     VALUES (?, ?, ?, ?)`
  ).run(record.category, record.scope || null, record.level || 'error', record.message);
}

export function getLatestSchedulerEvents(limit = 20): Array<{
  id: number;
  category: string;
  scope: string | null;
  level: string;
  message: string;
  created_at: string;
}> {
  const capped = Math.min(Math.max(limit, 1), 200);
  return db
    .prepare('SELECT id, category, scope, level, message, created_at FROM scheduler_events ORDER BY id DESC LIMIT ?')
    .all(capped) as any;
}

export function clearSchedulerEvents(): void {
  db.prepare('DELETE FROM scheduler_events').run();
}

export interface AuthSessionRecord {
  id: number;
  token_hash: string;
  username: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export function insertAuthSession(tokenHash: string, username: string, expiresAt: string): void {
  db.prepare(
    `INSERT INTO auth_sessions (token_hash, username, expires_at)
     VALUES (?, ?, ?)`
  ).run(tokenHash, username, expiresAt);
}

export function getAuthSessionByTokenHash(tokenHash: string): AuthSessionRecord | undefined {
  return db
    .prepare('SELECT id, token_hash, username, created_at, last_seen_at, expires_at FROM auth_sessions WHERE token_hash = ?')
    .get(tokenHash) as AuthSessionRecord | undefined;
}

export function touchAuthSession(tokenHash: string): void {
  db.prepare("UPDATE auth_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?").run(tokenHash);
}

export function deleteAuthSessionByTokenHash(tokenHash: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteAuthSessionsForUser(username: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE username = ?').run(username);
}

export function deleteExpiredAuthSessions(nowIso: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowIso);
}

export default db;
