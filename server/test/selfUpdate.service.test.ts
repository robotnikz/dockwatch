import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  realpathSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  openSync: vi.fn(),
  writeFileSync: vi.fn(),
  closeSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: fsMock,
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  spawnSync: childProcessMock.spawnSync,
  execFile: childProcessMock.execFile,
}));

const CONTAINER_ID = 'd82c7236f3b788bd4b3dc7b81b6f9b78c8f8bad316334cbefb0d6200ee2018ed';
const MOUNTINFO = `1 0 0:1 / / rw - overlay overlay rw
2 1 8:1 /var/lib/docker/containers/${CONTAINER_ID}/hostname /etc/hostname rw,relatime - ext4 /dev/sda1 rw
`;

function inspectPayload(overrides: { labels?: Record<string, string>; mounts?: unknown[] } = {}) {
  return JSON.stringify({
    Image: 'sha256:8ce45854d4a1',
    Config: {
      Labels: overrides.labels ?? {
        'com.docker.compose.project': 'dockwatch',
        'com.docker.compose.service': 'dockwatch',
        'com.docker.compose.project.working_dir': '/opt/dockwatch',
        'com.docker.compose.project.config_files': '/opt/dockwatch/docker-compose.yml',
      },
    },
    Mounts: overrides.mounts ?? [
      { Source: '/opt/dockwatch/data', Destination: '/app/data' },
      { Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' },
    ],
  });
}

type ExecHandler = (args: string[]) => { stdout?: string; error?: Error; stderr?: string };

function mockDocker(handler: ExecHandler) {
  childProcessMock.execFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
    const result = handler(args);
    if (result.error) cb(result.error, '', result.stderr ?? '');
    else cb(null, result.stdout ?? '', '');
  });
}

function setLocalModeMocks() {
  fsMock.readFileSync.mockReturnValue('1 0 0:1 / / rw - ext4 /dev/sda1 rw\n');
  fsMock.realpathSync.mockImplementation((input: string) => input);
  fsMock.existsSync.mockImplementation((input: string) => {
    const target = String(input);
    if (target === '/.dockerenv') return false;
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

describe('selfUpdate service (DockWatch running on the host)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DOCKWATCH_SELF_UPDATE_ENABLED = 'true';
    process.env.DOCKWATCH_SELF_UPDATE_DIR = '/opt/dockwatch';
    process.env.DOCKWATCH_STACKS = '/opt/stacks';
    process.env.DOCKWATCH_DATA = '/app/data';
    setLocalModeMocks();
  });

  it('reports local mode with the discovered compose file', async () => {
    const { getSelfUpdateInfo } = await import('../src/services/selfUpdate.js');

    const info = await getSelfUpdateInfo();

    expect(info).toMatchObject({ supported: true, mode: 'local', workingDir: '/opt/dockwatch', composeFile: 'docker-compose.yml' });
    expect(childProcessMock.execFile).not.toHaveBeenCalled();
  });

  it('triggers background update using pull before up and without down', async () => {
    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    const result = await triggerSelfUpdate();

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

    await expect(triggerSelfUpdate()).rejects.toThrow('Self-update already running');
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it('removes stale lock file and proceeds', async () => {
    const oldMtime = Date.now() - 16 * 60 * 1000;
    fsMock.existsSync.mockImplementation((input: string) => {
      const target = String(input);
      if (target === '/.dockerenv') return false;
      if (target.includes('dockwatch-self-update.lock')) return true;
      return target.endsWith('/docker-compose.yml');
    });
    fsMock.statSync.mockImplementation(() => ({ mtimeMs: oldMtime }));

    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    await triggerSelfUpdate();

    expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('dockwatch-self-update.lock'));
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('cleans up lock when spawning the background process fails', async () => {
    childProcessMock.spawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    await expect(triggerSelfUpdate()).rejects.toThrow('Failed to start self-update process: spawn failed');
    expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('dockwatch-self-update.lock'));
  });

  it('fails when docker compose is not available', async () => {
    childProcessMock.spawnSync.mockReturnValue({ status: 1, error: undefined });

    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    await expect(triggerSelfUpdate()).rejects.toThrow('docker compose is not available on this host');
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it('reports disabled self-update', async () => {
    process.env.DOCKWATCH_SELF_UPDATE_ENABLED = 'false';
    const { getSelfUpdateInfo, triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    expect(await getSelfUpdateInfo()).toMatchObject({ enabled: false, supported: false });
    await expect(triggerSelfUpdate()).rejects.toThrow('Self-update disabled by environment');
  });
});

describe('selfUpdate service (DockWatch running in a compose container)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DOCKWATCH_SELF_UPDATE_ENABLED = 'true';
    delete process.env.DOCKWATCH_SELF_UPDATE_DIR;
    setLocalModeMocks();
    fsMock.readFileSync.mockReturnValue(MOUNTINFO);
  });

  it('detects its own container id from mountinfo', async () => {
    const { detectOwnContainerId } = await import('../src/services/selfUpdate.js');
    expect(detectOwnContainerId()).toBe(CONTAINER_ID);
  });

  it('is supported via compose labels even when the compose dir is not mounted', async () => {
    mockDocker(() => ({ stdout: inspectPayload() }));
    const { getSelfUpdateInfo } = await import('../src/services/selfUpdate.js');

    const info = await getSelfUpdateInfo();

    expect(info).toEqual({
      enabled: true,
      supported: true,
      mode: 'helper',
      workingDir: '/opt/dockwatch',
      composeFile: '/opt/dockwatch/docker-compose.yml',
    });
    expect(childProcessMock.execFile.mock.calls[0][1]).toEqual(['inspect', CONTAINER_ID, '--format', '{{json .}}']);
  });

  it('starts a helper container that pulls and recreates only the DockWatch service', async () => {
    const calls: string[][] = [];
    mockDocker((args) => {
      calls.push(args);
      return { stdout: args[0] === 'inspect' ? inspectPayload() : 'helper-id\n' };
    });
    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    const result = await triggerSelfUpdate();

    expect(result).toEqual({ accepted: true, reloadAfterSeconds: 30 });
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
    const run = calls.find((args) => args[0] === 'run') as string[];
    expect(run).toBeDefined();
    expect(run).toEqual(expect.arrayContaining(['-d', '--rm', '--name', 'dockwatch-self-update']));
    expect(run).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(run).toContain('/opt/dockwatch:/opt/dockwatch:ro');
    expect(run).toContain('sha256:8ce45854d4a1');
    const script = run[run.length - 1];
    expect(script).toContain("docker 'compose' '-p' 'dockwatch' '--project-directory' '/opt/dockwatch' '-f' '/opt/dockwatch/docker-compose.yml' pull 'dockwatch'");
    expect(script).toContain("up -d --no-deps 'dockwatch'");
    expect(script).not.toContain(' down');
    expect(script.indexOf(' pull ')).toBeLessThan(script.indexOf(' up -d'));
  });

  it('maps a running helper container to "already running"', async () => {
    mockDocker((args) => (args[0] === 'inspect'
      ? { stdout: inspectPayload() }
      : { error: new Error('exit 125'), stderr: 'Conflict. The container name "/dockwatch-self-update" is already in use' }));
    const { triggerSelfUpdate } = await import('../src/services/selfUpdate.js');

    await expect(triggerSelfUpdate()).rejects.toThrow('Self-update already running');
  });

  it('is unsupported when DockWatch was not started by compose', async () => {
    mockDocker(() => ({ stdout: inspectPayload({ labels: {} }) }));
    const { getSelfUpdateInfo } = await import('../src/services/selfUpdate.js');

    const info = await getSelfUpdateInfo();
    expect(info.supported).toBe(false);
    expect(info.reason).toContain('not started with docker compose');
  });

  it('is unsupported without a docker socket mount (e.g. socket proxy)', async () => {
    mockDocker(() => ({ stdout: inspectPayload({ mounts: [] }) }));
    const { getSelfUpdateInfo } = await import('../src/services/selfUpdate.js');

    const info = await getSelfUpdateInfo();
    expect(info.supported).toBe(false);
    expect(info.reason).toContain('/var/run/docker.sock');
  });

  it('is unsupported when the container cannot be inspected', async () => {
    mockDocker(() => ({ error: new Error('boom'), stderr: 'permission denied' }));
    const { getSelfUpdateInfo } = await import('../src/services/selfUpdate.js');

    const info = await getSelfUpdateInfo();
    expect(info.supported).toBe(false);
    expect(info.reason).toContain('permission denied');
  });
});
