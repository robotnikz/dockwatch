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
    checked_at  TEXT NOT NULL DEFAULT (datetime('now'))
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

export function setUpdateCache(image: string, localDigest: string | null, remoteDigest: string | null): void {
  db.prepare(
    `INSERT OR REPLACE INTO update_cache (image, local_digest, remote_digest, checked_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(image, localDigest, remoteDigest);
}

export function getUpdateCache(image: string): { local_digest: string | null; remote_digest: string | null; checked_at: string } | undefined {
  return db.prepare('SELECT local_digest, remote_digest, checked_at FROM update_cache WHERE image = ?').get(image) as any;
}

export function getAllUpdateCache(): { image: string; local_digest: string | null; remote_digest: string | null; checked_at: string }[] {
  return db.prepare('SELECT * FROM update_cache ORDER BY image').all() as any[];
}

export default db;
