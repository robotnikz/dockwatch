import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteStackHistory,
  getStackHistoryVersion,
  listStackHistory,
  snapshotStack,
} from '../src/services/stackHistory.js';

const HISTORY_DIR = path.join(process.env.DOCKWATCH_DATA as string, 'history');

describe('stack history', () => {
  beforeEach(async () => {
    await deleteStackHistory('hist');
  });

  it('stores versions newest first with private file permissions', async () => {
    await snapshotStack('hist', { content: 'v1', env: null }, new Date('2026-10-06T10:00:00.000Z'));
    await snapshotStack('hist', { content: 'v2', env: 'SECRET=1\n' }, new Date('2026-10-06T11:00:00.000Z'));

    const versions = await listStackHistory('hist');
    expect(versions).toEqual([
      { id: '20261006T110000000Z', savedAt: '2026-10-06T11:00:00.000Z', hasEnv: true },
      { id: '20261006T100000000Z', savedAt: '2026-10-06T10:00:00.000Z', hasEnv: false },
    ]);
    expect(await getStackHistoryVersion('hist', versions[0].id)).toEqual({ content: 'v2', env: 'SECRET=1\n' });
    expect(await getStackHistoryVersion('hist', versions[1].id)).toEqual({ content: 'v1', env: null });

    const envStat = await fs.stat(path.join(HISTORY_DIR, 'hist', `${versions[0].id}.env`));
    expect(envStat.mode & 0o777).toBe(0o600);
  });

  it('skips a snapshot identical to the newest version', async () => {
    const at = new Date('2026-10-06T10:00:00.000Z');
    await snapshotStack('hist', { content: 'same', env: 'A=1' }, at);
    await snapshotStack('hist', { content: 'same', env: 'A=1' }, new Date(at.getTime() + 1000));
    expect(await listStackHistory('hist')).toHaveLength(1);
  });

  it('keeps two snapshots taken in the same millisecond', async () => {
    const at = new Date('2026-10-06T10:00:00.000Z');
    await snapshotStack('hist', { content: 'a', env: null }, at);
    await snapshotStack('hist', { content: 'b', env: null }, at);
    const versions = await listStackHistory('hist');
    expect(versions.map((v) => v.id)).toEqual(['20261006T100000000Z-1', '20261006T100000000Z']);
  });

  it('keeps only the newest 20 versions', async () => {
    const start = Date.parse('2026-10-01T00:00:00.000Z');
    for (let i = 0; i < 23; i += 1) {
      await snapshotStack('hist', { content: `v${i}`, env: i % 2 ? 'X=1' : null }, new Date(start + i * 60_000));
    }

    const versions = await listStackHistory('hist');
    expect(versions).toHaveLength(20);
    expect((await getStackHistoryVersion('hist', versions[0].id)).content).toBe('v22');
    expect((await getStackHistoryVersion('hist', versions[19].id)).content).toBe('v3');
    const files = await fs.readdir(path.join(HISTORY_DIR, 'hist'));
    expect(files.some((file) => file.startsWith('20261001T000000000Z'))).toBe(false);
  });

  it('rejects path traversal in stack names and version ids', async () => {
    await expect(listStackHistory('../etc')).rejects.toThrow('Invalid stack name');
    await expect(getStackHistoryVersion('hist', '../../dockwatch.db')).rejects.toThrow('Invalid version id');
  });

  it('returns an empty list for stacks without history and removes history on delete', async () => {
    expect(await listStackHistory('never-saved')).toEqual([]);
    await snapshotStack('hist', { content: 'x', env: null });
    await deleteStackHistory('hist');
    expect(await listStackHistory('hist')).toEqual([]);
  });
});
