import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  realpathSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  openSync: vi.fn(),
  writeFileSync: vi.fn(),
  closeSync: vi.fn(),
}));

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: fsMock,
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  spawnSync: childProcessMock.spawnSync,
}));

function setDefaultMocks() {
  fsMock.realpathSync.mockImplementation((input: string) => input);
  fsMock.existsSync.mockImplementation((input: string) => {
    const target = String(input);
    if (target.includes('dockwatch-self-update.lock')) return false;
    return target.endsWith('/docker-compose.yml');
  });
  fsMock.statSync.mockImplementation(() => ({ mtimeMs: Date.now() }));
  fsMock.unlinkSync.mockImplementation(() => undefined);
  fsMock.openSync.mockReturnValue(42);
  fsMock.writeFileSync.mockImplementation(() => undefined);
  fsMock.closeSync.mockImplementation(() => undefined);

  childProcessMock.spawnSync.mockReturnValue({ status: 0, error: undefined });
  childProcessMock.spawn.mockReturnValue({ unref: vi.fn() });
}

describe('selfUpdate service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DOCKWATCH_SELF_UPDATE_ENABLED = 'true';
    process.env.DOCKWATCH_SELF_UPDATE_DIR = '/opt/dockwatch';
    process.env.DOCKWATCH_STACKS = '/opt/stacks';
    process.env.DOCKWATCH_DATA = '/app/data';
    setDefaultMocks();
  });

  it('triggers background update using pull before up and without down', async () => {
    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    const result = triggerSelfUpdate();

    expect(result).toEqual({ accepted: true, reloadAfterSeconds: 30 });
    expect(childProcessMock.spawnSync).toHaveBeenCalledWith('docker', ['compose', 'version'], { stdio: 'ignore' });
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);

    const spawnArgs = childProcessMock.spawn.mock.calls[0];
    expect(spawnArgs[0]).toBe('sh');
    expect(spawnArgs[1][0]).toBe('-lc');
    expect(spawnArgs[1][1]).toContain('docker compose -f');
    expect(spawnArgs[1][1]).toContain(' pull');
    expect(spawnArgs[1][1]).toContain(' up -d --remove-orphans');
    expect(spawnArgs[1][1]).not.toContain(' down');
  });

  it('blocks when a fresh lock file exists', async () => {
    fsMock.openSync.mockImplementation(() => {
      const err = new Error('exists') as Error & { code?: string };
      err.code = 'EEXIST';
      throw err;
    });

    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    expect(() => triggerSelfUpdate()).toThrow('Self-update already running');
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it('removes stale lock file and proceeds', async () => {
    const oldMtime = Date.now() - 16 * 60 * 1000;
    fsMock.existsSync.mockImplementation((input: string) => {
      const target = String(input);
      if (target.includes('dockwatch-self-update.lock')) return true;
      return target.endsWith('/docker-compose.yml');
    });
    fsMock.statSync.mockImplementation(() => ({ mtimeMs: oldMtime }));

    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    triggerSelfUpdate();

    expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('dockwatch-self-update.lock'));
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('cleans up lock when spawning the background process fails', async () => {
    childProcessMock.spawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    expect(() => triggerSelfUpdate()).toThrow('Failed to start self-update process: spawn failed');
    expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('dockwatch-self-update.lock'));
  });

  it('fails when docker compose is not available', async () => {
    childProcessMock.spawnSync.mockReturnValue({ status: 1, error: undefined });

    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    expect(() => triggerSelfUpdate()).toThrow('docker compose is not available on this host');
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });
});
