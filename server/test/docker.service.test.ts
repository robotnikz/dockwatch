import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  execFile: childProcessMock.execFile,
}));

const docker = await import('../src/services/docker.js');

const STACKS_DIR = process.env.DOCKWATCH_STACKS as string;

interface SpawnCall {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  child: FakeChild;
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    setImmediate(() => this.emit('close', null));
    return true;
  });

  finish(code = 0, stdout = '', stderr = '') {
    if (stdout) this.stdout.emit('data', Buffer.from(stdout));
    if (stderr) this.stderr.emit('data', Buffer.from(stderr));
    this.emit('close', code);
  }
}

type Responder = (composeArgs: string[]) => { code?: number; stdout?: string; stderr?: string } | 'hang';

let calls: SpawnCall[] = [];

function respondWith(responder: Responder) {
  childProcessMock.spawn.mockImplementation((_cmd: string, args: string[], opts: { cwd: string; env: Record<string, string> }) => {
    const child = new FakeChild();
    calls.push({ args, cwd: opts.cwd, env: opts.env, child });
    // args = ['compose', '--ansi', 'always', ...composeArgs]
    const result = responder(args.slice(3));
    if (result !== 'hang') {
      setImmediate(() => child.finish(result.code ?? 0, result.stdout ?? '', result.stderr ?? ''));
    }
    return child;
  });
}

const composeArgs = () => calls.map((call) => call.args.slice(3));

async function createStack(name: string, compose: string, fileName = 'compose.yaml') {
  const dir = path.join(STACKS_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), compose);
  return dir;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('docker service: compose commands', () => {
  beforeEach(() => {
    calls = [];
    childProcessMock.spawn.mockReset();
    childProcessMock.execFile.mockReset();
    respondWith(() => ({}));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DOCKWATCH_COMPOSE_ENV_PASSTHROUGH;
  });

  it('updates a single service: pull <svc> then up -d --no-deps <svc>', async () => {
    await createStack('svcupdate', 'services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n');

    await docker.composeManualUpdateService('svcupdate', 'web');

    expect(composeArgs()).toEqual([
      ['pull', 'web'],
      ['up', '-d', '--no-deps', 'web'],
    ]);
  });

  it('rejects flag-like service names before running compose', async () => {
    await expect(docker.composeManualUpdateService('svcupdate', '--no-log-prefix')).rejects.toThrow('Invalid service name');
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it('updates a whole stack with pull then up, never down', async () => {
    await createStack('manual', 'services:\n  web:\n    image: nginx\n');

    await docker.composeManualUpdate('manual');

    expect(composeArgs()).toEqual([
      ['pull'],
      ['up', '-d', '--remove-orphans'],
    ]);
  });

  it('keeps containers running when the pull of a manual update fails', async () => {
    await createStack('manualfail', 'services:\n  web:\n    image: nginx\n');
    respondWith((args) => (args[0] === 'pull' ? { code: 1, stderr: 'manifest unknown' } : {}));

    await expect(docker.composeManualUpdate('manualfail')).rejects.toThrow('manifest unknown');
    expect(composeArgs()).toEqual([['pull']]);
  });

  it('auto-update only recreates running, non-excluded services', async () => {
    await createStack('auto', [
      'services:',
      '  app:',
      '    image: nginx',
      '  db:',
      '    image: postgres',
      '    labels:',
      '      - dockwatch.update.exclude=true',
      '  worker:',
      '    image: busybox',
      '',
    ].join('\n'));
    respondWith((args) => (args[0] === 'ps' ? { stdout: 'app\ndb\n' } : {}));

    const output = await docker.composePullAndRecreate('auto', ['app', 'db', 'worker']);

    expect(composeArgs()).toEqual([
      ['ps', '--services', '--status', 'running'],
      ['pull', 'app'],
      ['up', '-d', '--no-deps', 'app'],
    ]);
    expect(output).toContain('Skipping auto-update for excluded service: db');
    expect(output).toContain('Skipping auto-update for service that is not running: worker');
  });

  it('auto-update leaves a stopped stack alone', async () => {
    await createStack('autostopped', 'services:\n  app:\n    image: nginx\n');
    respondWith(() => ({ stdout: '' }));

    const output = await docker.composePullAndRecreate('autostopped', ['app']);

    expect(composeArgs()).toEqual([['ps', '--services', '--status', 'running']]);
    expect(output).toContain('No running, non-excluded services to update.');
  });

  it('runs compose in the stack dir with a minimal environment', async () => {
    const dir = await createStack('envleak', 'services:\n  app:\n    image: nginx\n');
    process.env.PORT = '3000';
    process.env.NODE_ENV = 'production';
    process.env.MY_PUID = '1000';
    process.env.DOCKWATCH_COMPOSE_ENV_PASSTHROUGH = 'MY_PUID, not valid!';

    await docker.composeUp('envleak');

    const call = calls[0];
    expect(call.cwd).toBe(dir);
    expect(call.args.slice(0, 3)).toEqual(['compose', '--ansi', 'always']);
    expect(call.env.COMPOSE_PROJECT_NAME).toBe('envleak');
    expect(call.env.PATH).toBe(process.env.PATH);
    expect(call.env.MY_PUID).toBe('1000');
    // DockWatch's own variables must not override the stack's .env during interpolation.
    expect(call.env).not.toHaveProperty('PORT');
    expect(call.env).not.toHaveProperty('NODE_ENV');
    expect(call.env).not.toHaveProperty('DOCKWATCH_STACKS');
    expect(call.env).not.toHaveProperty('DOCKWATCH_DATA');
    delete process.env.MY_PUID;
  });

  it('stops a hanging compose command after the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await createStack('hang', 'services:\n  app:\n    image: nginx\n');
    respondWith(() => 'hang');
    const chunks: string[] = [];

    const pending = docker.composeUp('hang', (chunk) => chunks.push(chunk));
    const assertion = expect(pending).rejects.toThrow('timed out');
    await flush();
    await vi.advanceTimersByTimeAsync(30 * 60_000);

    await assertion;
    expect(calls[0].child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(chunks.join('')).toContain('timed out');
  });

  it('serializes operations on the same stack but not across stacks', async () => {
    await createStack('locka', 'services:\n  app:\n    image: nginx\n');
    await createStack('lockb', 'services:\n  app:\n    image: nginx\n');
    respondWith(() => 'hang');
    const chunks: string[] = [];

    const first = docker.composeUp('locka');
    await flush();
    const second = docker.composeDown('locka', (chunk) => chunks.push(chunk));
    const other = docker.composeUp('lockb');
    await flush();
    await flush();

    // locka/down waits for locka/up; lockb runs right away.
    expect(calls.map((c) => `${path.basename(c.cwd)}:${c.args[3]}`)).toEqual(['locka:up', 'lockb:up']);
    expect(docker.isStackBusy('locka')).toBe(true);
    expect(chunks.join('')).toContain('Waiting for another operation on stack locka');

    calls[0].child.finish(0);
    await first;
    await flush();
    await flush();
    expect(calls.map((c) => `${path.basename(c.cwd)}:${c.args[3]}`)).toEqual(['locka:up', 'lockb:up', 'locka:down']);

    calls[2].child.finish(0);
    calls[1].child.finish(0);
    await Promise.all([second, other]);
    expect(docker.isStackBusy('locka')).toBe(false);
  });

  it('reports compose config warnings and errors', async () => {
    await createStack('cfg', 'services:\n  app:\n    image: nginx:${TAG}\n');
    respondWith(() => ({ stderr: '\x1b[33mWARN\x1b[0m The "TAG" variable is not set.\n' }));
    expect(await docker.validateComposeConfig('cfg')).toEqual(['WARN The "TAG" variable is not set.']);
    expect(composeArgs()).toEqual([['config', '--quiet']]);

    respondWith(() => ({ code: 15, stderr: 'service "app" has neither an image nor a build context\n' }));
    expect(await docker.validateComposeConfig('cfg')).toEqual(['service "app" has neither an image nor a build context']);

    childProcessMock.spawn.mockImplementation(() => {
      const child = new FakeChild();
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' })));
      return child;
    });
    expect(await docker.validateComposeConfig('cfg')).toEqual([]);
  });

  it('deletes a stack after stopping it', async () => {
    const dir = await createStack('todelete', 'services:\n  app:\n    image: nginx\n');

    await docker.deleteStack('todelete');

    expect(composeArgs()).toEqual([['down']]);
    await expect(fs.access(dir)).rejects.toThrow();
  });
});

describe('docker service: files', () => {
  it('creates a new .env with mode 600 and keeps the mode of existing files', async () => {
    const dir = await createStack('envfile', 'services: {}\n');

    await docker.saveEnvContent('envfile', 'TOKEN=secret\n');
    const created = await fs.stat(path.join(dir, '.env'));
    expect(created.mode & 0o777).toBe(0o600);
    expect(await docker.getEnvContent('envfile')).toBe('TOKEN=secret\n');

    await fs.chmod(path.join(dir, '.env'), 0o644);
    await docker.saveEnvContent('envfile', 'TOKEN=changed\n');
    const updated = await fs.stat(path.join(dir, '.env'));
    expect(updated.mode & 0o777).toBe(0o644);
    expect(await docker.getStackEnv('envfile')).toEqual({ TOKEN: 'changed' });
  });

  it('never deletes an existing .env and does not create an empty one', async () => {
    const dir = await createStack('envempty', 'services: {}\n');

    await docker.saveEnvContent('envempty', '   ');
    await expect(fs.access(path.join(dir, '.env'))).rejects.toThrow();
    expect(await docker.getEnvContent('envempty')).toBeNull();

    await docker.saveEnvContent('envempty', 'A=1\n');
    await docker.saveEnvContent('envempty', '');
    expect(await docker.getEnvContent('envempty')).toBe('');
  });

  it('saves back to a legacy docker-compose.yml instead of shadowing it', async () => {
    const dir = await createStack('legacy', 'services:\n  old: {}\n', 'docker-compose.yml');

    await docker.saveComposeContent('legacy', 'services:\n  new: {}\n');

    expect(await fs.readFile(path.join(dir, 'docker-compose.yml'), 'utf-8')).toContain('new');
    await expect(fs.access(path.join(dir, 'compose.yaml'))).rejects.toThrow();
    expect(await docker.getComposeFileName('legacy')).toBe('docker-compose.yml');
    expect(await docker.stackExists('legacy')).toBe(true);
  });

  it('lists stacks with any compose file name and reports extra files', async () => {
    const dir = await createStack('ymlstack', 'services: {}\n', 'compose.yml');
    await fs.mkdir(path.join(dir, 'data'), { recursive: true });
    await fs.writeFile(path.join(dir, '.env'), 'A=1\n');
    await fs.mkdir(path.join(STACKS_DIR, 'no compose here'), { recursive: true });

    const stacks = await docker.listStacks();

    expect(stacks).toContain('ymlstack');
    expect(stacks).not.toContain('no compose here');
    expect(await docker.listExtraStackFiles('ymlstack')).toEqual(['data/']);
    expect(await docker.stackExists('does-not-exist')).toBe(false);
  });

  it('rejects path traversal in stack names', () => {
    expect(() => docker.stackDir('../etc')).toThrow('Invalid stack name');
  });
});

describe('docker service: containers and images', () => {
  beforeEach(() => {
    childProcessMock.execFile.mockReset();
  });

  function mockExec(stdout: string) {
    childProcessMock.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout, stderr: '' });
    });
  }

  it('groups containers by compose project from one docker ps call', async () => {
    mockExec([
      'media-app-1\trunning\tUp 2 hours (healthy)\tnginx\tMedia\tapp\tFalse',
      'media-db-1\texited\tExited (137) 5 minutes ago\tpostgres\tmedia\tdb\tFalse',
      'media-run-1\texited\tExited (0) 1 hour ago\tnginx\tmedia\tapp\tTrue',
      'other-web-1\trunning\tUp 3 seconds (health: starting)\tnginx\tother\tweb\tFalse',
      '',
    ].join('\n'));

    const byProject = await docker.getContainersByProject();

    const args = childProcessMock.execFile.mock.calls[0][1];
    expect(args.slice(0, 4)).toEqual(['ps', '-a', '--filter', 'label=com.docker.compose.project']);
    expect([...byProject.keys()].sort()).toEqual(['media', 'other']);
    expect(byProject.get('media')).toEqual([
      { Name: 'media-app-1', Service: 'app', State: 'running', Status: 'Up 2 hours (healthy)', Health: 'healthy', Image: 'nginx', ExitCode: null },
      { Name: 'media-db-1', Service: 'db', State: 'exited', Status: 'Exited (137) 5 minutes ago', Health: '', Image: 'postgres', ExitCode: 137 },
    ]);
    expect(byProject.get('other')?.[0].Health).toBe('starting');
  });

  it('computes stack status from container states', () => {
    expect(docker.computeStackStatus([])).toBe('stopped');
    expect(docker.computeStackStatus([{ State: 'exited', ExitCode: 0 }])).toBe('stopped');
    expect(docker.computeStackStatus([{ State: 'running', ExitCode: null }])).toBe('running');
    expect(docker.computeStackStatus([{ State: 'running', ExitCode: null }, { State: 'exited', ExitCode: 0 }])).toBe('running');
    expect(docker.computeStackStatus([{ State: 'running', ExitCode: null }, { State: 'exited', ExitCode: 1 }])).toBe('partial');
    expect(docker.computeStackStatus([{ State: 'running', ExitCode: null }, { State: 'restarting', ExitCode: null }])).toBe('partial');
  });

  it('returns all repo digests of a local image, or null when it is missing', async () => {
    mockExec('["nginx@sha256:aaa","docker.io/library/nginx@sha256:bbb"]\n');
    expect(await docker.getImageRepoDigests('nginx:latest')).toEqual(['nginx@sha256:aaa', 'docker.io/library/nginx@sha256:bbb']);

    childProcessMock.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error('No such image'));
    });
    expect(await docker.getImageRepoDigests('missing:latest')).toBeNull();
  });

  it('reads boolean dockwatch labels in list and map syntax', () => {
    expect(docker.hasTrueLabel(['dockwatch.update.exclude=true'], 'dockwatch.update.exclude')).toBe(true);
    expect(docker.hasTrueLabel(['dockwatch.update.exclude = TRUE'], 'dockwatch.update.exclude')).toBe(true);
    expect(docker.hasTrueLabel(['dockwatch.update.exclude=false'], 'dockwatch.update.exclude')).toBe(false);
    expect(docker.hasTrueLabel(['dockwatch.update.check.exclude=true'], 'dockwatch.update.exclude')).toBe(false);
    expect(docker.hasTrueLabel({ 'dockwatch.update.exclude': true }, 'dockwatch.update.exclude')).toBe(true);
    expect(docker.hasTrueLabel({ 'dockwatch.update.exclude': 'false' }, 'dockwatch.update.exclude')).toBe(false);
    expect(docker.hasTrueLabel(null, 'dockwatch.update.exclude')).toBe(false);
  });
});
