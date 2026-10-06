import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listStacks: vi.fn(),
  getComposeContent: vi.fn(),
  saveComposeContent: vi.fn(),
  deleteStack: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
  composeRestart: vi.fn(),
  composePull: vi.fn(),
  composeManualUpdate: vi.fn(),
  composeManualUpdateService: vi.fn(),
  composeLogs: vi.fn(),
  composeContainerLogs: vi.fn(),
  getContainersByProject: vi.fn(),
  getEnvContent: vi.fn(),
  saveEnvContent: vi.fn(),
  getComposeFileName: vi.fn(),
  listExtraStackFiles: vi.fn(),
  stackExists: vi.fn(),
  validateComposeConfig: vi.fn(),
  getStackImages: vi.fn(),
  stackDir: vi.fn(),
  notifyStackAction: vi.fn(),
  registerStack: vi.fn(),
  removeStack: vi.fn(),
  snapshotStack: vi.fn(),
  listStackHistory: vi.fn(),
  getStackHistoryVersion: vi.fn(),
  deleteStackHistory: vi.fn(),
}));

vi.mock('../src/services/docker.js', () => ({
  listStacks: mocks.listStacks,
  getComposeContent: mocks.getComposeContent,
  saveComposeContent: mocks.saveComposeContent,
  deleteStack: mocks.deleteStack,
  composeUp: mocks.composeUp,
  composeDown: mocks.composeDown,
  composeRestart: mocks.composeRestart,
  composePull: mocks.composePull,
  composeManualUpdate: mocks.composeManualUpdate,
  composeManualUpdateService: mocks.composeManualUpdateService,
  composeLogs: mocks.composeLogs,
  composeContainerLogs: mocks.composeContainerLogs,
  getContainersByProject: mocks.getContainersByProject,
  computeStackStatus: actualComputeStackStatus,
  getEnvContent: mocks.getEnvContent,
  saveEnvContent: mocks.saveEnvContent,
  getComposeFileName: mocks.getComposeFileName,
  listExtraStackFiles: mocks.listExtraStackFiles,
  stackExists: mocks.stackExists,
  validateComposeConfig: mocks.validateComposeConfig,
  getStackImages: mocks.getStackImages,
  stackDir: mocks.stackDir,
  isValidComposeServiceName: (service: string) => /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(String(service || '').trim()),
}));

vi.mock('../src/services/stackHistory.js', () => ({
  snapshotStack: mocks.snapshotStack,
  listStackHistory: mocks.listStackHistory,
  getStackHistoryVersion: mocks.getStackHistoryVersion,
  deleteStackHistory: mocks.deleteStackHistory,
}));

vi.mock('../src/services/discord.js', () => ({
  notifyStackAction: mocks.notifyStackAction,
}));

vi.mock('../src/db.js', () => ({
  registerStack: mocks.registerStack,
  removeStack: mocks.removeStack,
}));

const { computeStackStatus: actualComputeStackStatus } = await vi.importActual<typeof import('../src/services/docker.js')>('../src/services/docker.js');
const { default: stacksRouter } = await import('../src/routes/stacks.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/stacks', stacksRouter);
  return app;
}

describe('stacks routes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as any).mockReset();
      }
    });
  });

  it('streams stack up action via SSE and marks finish', async () => {
    mocks.composeUp.mockImplementation(async (_name: string, onChunk?: (chunk: string) => void) => {
      onChunk?.('pulling image...\\n');
      onChunk?.('starting container...\\n');
      return 'ok';
    });
    mocks.notifyStackAction.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/stacks/demo/up?stream=true');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('pulling image...');
    expect(res.text).toContain('starting container...');
    expect(res.text).toContain('"finish":true');
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'started', true);
  });

  it('streams service update errors via SSE and reports notify failure action', async () => {
    mocks.composeManualUpdateService.mockRejectedValue(new Error('service update failed'));
    mocks.notifyStackAction.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/stacks/demo/update/app?stream=true');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('service update failed');
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'update service app', false);
  });

  it('rejects stack save when content is missing', async () => {
    const res = await request(buildApp()).put('/stacks/demo').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('content (string) is required');
  });

  it('rejects stack save when compose yaml is invalid', async () => {
    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\n  app:\n    image: nginx:latest\n    bad: [\n' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid YAML');
    expect(mocks.saveComposeContent).not.toHaveBeenCalled();
  });

  it('saves stack and registers path', async () => {
    mocks.saveComposeContent.mockResolvedValue(undefined);
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    mocks.stackExists.mockResolvedValue(false);
    mocks.validateComposeConfig.mockResolvedValue([]);
    mocks.registerStack.mockReturnValue(undefined);

    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\n  app:\n    image: nginx:latest\n' });

    expect(res.status).toBe(200);
    expect(mocks.saveComposeContent).toHaveBeenCalledWith('demo', expect.any(String));
    expect(mocks.registerStack).toHaveBeenCalledWith('demo', '/opt/stacks/demo');
    expect(mocks.saveEnvContent).not.toHaveBeenCalled();
    expect(mocks.snapshotStack).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true, name: 'demo', warnings: [] });
  });

  it('writes the .env file only when env is part of the request', async () => {
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    mocks.stackExists.mockResolvedValue(true);
    mocks.getComposeContent.mockResolvedValue('services:\n  app:\n    image: nginx:latest\n');
    mocks.getEnvContent.mockResolvedValue('PORT=8080\n');
    mocks.validateComposeConfig.mockResolvedValue([]);

    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\n  app:\n    image: nginx:latest\n', env: 'PORT=9090\n' });

    expect(res.status).toBe(200);
    expect(mocks.saveEnvContent).toHaveBeenCalledWith('demo', 'PORT=9090\n');
    // The previous state is kept in the history because the .env changed.
    expect(mocks.snapshotStack).toHaveBeenCalledWith('demo', {
      content: 'services:\n  app:\n    image: nginx:latest\n',
      env: 'PORT=8080\n',
    });
  });

  it('ignores the legacy envContent field so old clients cannot wipe .env files', async () => {
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    mocks.stackExists.mockResolvedValue(true);
    mocks.getComposeContent.mockResolvedValue('services:\n  app:\n    image: nginx:latest\n');
    mocks.getEnvContent.mockResolvedValue('SECRET=1\n');
    mocks.validateComposeConfig.mockResolvedValue([]);

    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\n  app:\n    image: nginx:latest\n', envContent: '' });

    expect(res.status).toBe(200);
    expect(mocks.saveEnvContent).not.toHaveBeenCalled();
    // Nothing changed, so no history entry is written.
    expect(mocks.snapshotStack).not.toHaveBeenCalled();
  });

  it('rejects a non-string env value', async () => {
    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services: {}\n', env: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('env must be a string');
    expect(mocks.saveComposeContent).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an existing stack when creating', async () => {
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    mocks.stackExists.mockResolvedValue(true);

    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\n  app:\n    image: nginx:latest\n', env: '', create: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
    expect(mocks.saveComposeContent).not.toHaveBeenCalled();
    expect(mocks.saveEnvContent).not.toHaveBeenCalled();
  });

  it('returns compose config warnings and still saves', async () => {
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    mocks.stackExists.mockResolvedValue(false);
    mocks.validateComposeConfig.mockResolvedValue(['WARN[0000] The "TOKEN" variable is not set.']);

    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\n  app:\n    image: nginx:latest\n', env: '', create: true });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['WARN[0000] The "TOKEN" variable is not set.']);
    expect(mocks.saveComposeContent).toHaveBeenCalled();
  });

  it('keeps saving when the history snapshot fails and reports it', async () => {
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    mocks.stackExists.mockResolvedValue(true);
    mocks.getComposeContent.mockResolvedValue('services: {}\n');
    mocks.getEnvContent.mockResolvedValue(null);
    mocks.snapshotStack.mockRejectedValue(new Error('disk full'));
    mocks.validateComposeConfig.mockResolvedValue([]);

    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\n  app:\n    image: nginx:latest\n' });

    expect(res.status).toBe(200);
    expect(res.body.warnings[0]).toContain('disk full');
    expect(mocks.saveComposeContent).toHaveBeenCalled();
  });

  it('lists stacks with running, partial, and stopped status resolution from one docker ps', async () => {
    mocks.listStacks.mockResolvedValue(['Run', 'partial', 'stopped', 'oneshot']);
    const c = (Service: string, State: string, ExitCode: number | null = null) => ({
      Name: `x-${Service}`, Service, State, Status: '', Health: '', Image: 'img', ExitCode,
    });
    mocks.getContainersByProject.mockResolvedValue(new Map([
      ['run', [c('a', 'running'), c('b', 'running')]],
      ['partial', [c('a', 'running'), c('b', 'exited', 137)]],
      ['stopped', [c('a', 'exited', 0)]],
      ['oneshot', [c('app', 'running'), c('migrate', 'exited', 0)]],
    ]));

    const res = await request(buildApp()).get('/stacks');

    expect(res.status).toBe(200);
    expect(mocks.getContainersByProject).toHaveBeenCalledTimes(1);
    expect(res.body).toHaveLength(4);
    expect(res.body[0]).toMatchObject({ name: 'Run', status: 'running' });
    expect(res.body[0].services).toHaveLength(2);
    expect(res.body[1]).toMatchObject({ name: 'partial', status: 'partial' });
    expect(res.body[2]).toMatchObject({ name: 'stopped', status: 'stopped' });
    expect(res.body[3]).toMatchObject({ name: 'oneshot', status: 'running' });
  });

  it('reports unknown status when docker ps fails', async () => {
    mocks.listStacks.mockResolvedValue(['demo']);
    mocks.getContainersByProject.mockRejectedValue(new Error('ps failed'));

    const res = await request(buildApp()).get('/stacks');

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ name: 'demo', status: 'unknown', services: [] });
  });

  it('returns stack compose and .env content and 404 when missing', async () => {
    mocks.getComposeContent.mockResolvedValueOnce('services:\n  app:\n    image: nginx\n');
    mocks.getEnvContent.mockResolvedValueOnce('PORT=8080\n');
    mocks.getComposeFileName.mockResolvedValueOnce('docker-compose.yml');
    mocks.listExtraStackFiles.mockResolvedValueOnce(['data/']);
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    const okRes = await request(buildApp()).get('/stacks/demo');
    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({
      name: 'demo',
      path: '/opt/stacks/demo',
      content: 'services:\n  app:\n    image: nginx\n',
      env: 'PORT=8080\n',
      composeFile: 'docker-compose.yml',
      extraFiles: ['data/'],
    });

    mocks.getComposeContent.mockRejectedValueOnce(new Error('missing'));
    const notFoundRes = await request(buildApp()).get('/stacks/missing');
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error).toContain('Stack not found: missing');
  });

  it('deletes stack and unregisters it', async () => {
    mocks.deleteStack.mockResolvedValue(undefined);
    mocks.removeStack.mockReturnValue(undefined);

    const res = await request(buildApp()).delete('/stacks/demo');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mocks.deleteStack).toHaveBeenCalledWith('demo');
    expect(mocks.deleteStackHistory).toHaveBeenCalledWith('demo');
    expect(mocks.removeStack).toHaveBeenCalledWith('demo');
  });

  it('lists and returns previous versions', async () => {
    mocks.listStackHistory.mockResolvedValue([
      { id: '20261006T101500000Z', savedAt: '2026-10-06T10:15:00.000Z', hasEnv: true },
    ]);
    mocks.getStackHistoryVersion.mockResolvedValue({ content: 'services: {}\n', env: 'A=1\n' });

    const list = await request(buildApp()).get('/stacks/demo/history');
    expect(list.status).toBe(200);
    expect(list.body.versions).toHaveLength(1);

    const version = await request(buildApp()).get('/stacks/demo/history/20261006T101500000Z');
    expect(version.status).toBe(200);
    expect(version.body).toEqual({ content: 'services: {}\n', env: 'A=1\n' });
    expect(mocks.getStackHistoryVersion).toHaveBeenCalledWith('demo', '20261006T101500000Z');
  });

  it('maps missing and invalid history versions to 404 and 400', async () => {
    mocks.getStackHistoryVersion.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const missing = await request(buildApp()).get('/stacks/demo/history/20261006T101500000Z');
    expect(missing.status).toBe(404);

    mocks.getStackHistoryVersion.mockRejectedValueOnce(new Error('Invalid version id: x'));
    const invalid = await request(buildApp()).get('/stacks/demo/history/x');
    expect(invalid.status).toBe(400);

    mocks.listStackHistory.mockRejectedValueOnce(new Error('Invalid stack name: ..'));
    const badList = await request(buildApp()).get('/stacks/demo/history');
    expect(badList.status).toBe(400);
  });

  it('runs non-stream stack actions and returns command output', async () => {
    mocks.composeDown.mockResolvedValue('down-ok');
    mocks.composeRestart.mockResolvedValue('restart-ok');
    mocks.composePull.mockResolvedValue('pull-ok');
    mocks.composeManualUpdate.mockResolvedValue('update-ok');
    mocks.composeManualUpdateService.mockResolvedValue('update-service-ok');
    mocks.notifyStackAction.mockResolvedValue(undefined);

    const downRes = await request(buildApp()).post('/stacks/demo/down');
    expect(downRes.status).toBe(200);
    expect(downRes.body).toEqual({ ok: true, output: 'down-ok' });

    const restartRes = await request(buildApp()).post('/stacks/demo/restart');
    expect(restartRes.status).toBe(200);
    expect(restartRes.body).toEqual({ ok: true, output: 'restart-ok' });

    const pullRes = await request(buildApp()).post('/stacks/demo/pull');
    expect(pullRes.status).toBe(200);
    expect(pullRes.body).toEqual({ ok: true, output: 'pull-ok' });

    const updateRes = await request(buildApp()).post('/stacks/demo/update');
    expect(updateRes.status).toBe(200);
    expect(updateRes.body).toEqual({ ok: true, output: 'update-ok' });

    const serviceRes = await request(buildApp()).post('/stacks/demo/update/app');
    expect(serviceRes.status).toBe(200);
    expect(serviceRes.body).toEqual({ ok: true, output: 'update-service-ok' });

    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'stopped', true);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'restarted', true);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'updated', true);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'updated service app', true);
  });

  it('returns 500 for non-stream action failures and marks failed notify action', async () => {
    mocks.composeUp.mockRejectedValueOnce(new Error('up-failed'));
    mocks.composeDown.mockRejectedValueOnce(new Error('down-failed'));
    mocks.composeRestart.mockRejectedValueOnce(new Error('restart-failed'));
    mocks.composePull.mockRejectedValueOnce(new Error('pull-failed'));
    mocks.composeManualUpdate.mockRejectedValueOnce(new Error('update-failed'));
    mocks.composeManualUpdateService.mockRejectedValueOnce(new Error('update-service-failed'));
    mocks.notifyStackAction.mockResolvedValue(undefined);

    const upRes = await request(buildApp()).post('/stacks/demo/up');
    expect(upRes.status).toBe(500);
    expect(upRes.body.error).toContain('up-failed');

    const downRes = await request(buildApp()).post('/stacks/demo/down');
    expect(downRes.status).toBe(500);
    expect(downRes.body.error).toContain('down-failed');

    const restartRes = await request(buildApp()).post('/stacks/demo/restart');
    expect(restartRes.status).toBe(500);
    expect(restartRes.body.error).toContain('restart-failed');

    const pullRes = await request(buildApp()).post('/stacks/demo/pull');
    expect(pullRes.status).toBe(500);
    expect(pullRes.body.error).toContain('pull-failed');

    const updateRes = await request(buildApp()).post('/stacks/demo/update');
    expect(updateRes.status).toBe(500);
    expect(updateRes.body.error).toContain('update-failed');

    const serviceRes = await request(buildApp()).post('/stacks/demo/update/app');
    expect(serviceRes.status).toBe(500);
    expect(serviceRes.body.error).toContain('update-service-failed');

    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'start', false);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'stop', false);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'restart', false);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'update', false);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'update service app', false);
  });

  it('returns logs with tail clamped to 1000 and default fallback', async () => {
    mocks.composeLogs.mockResolvedValue('line1\nline2');

    const clamped = await request(buildApp()).get('/stacks/demo/logs?tail=5000');
    expect(clamped.status).toBe(200);
    expect(clamped.body.output).toContain('line1');
    expect(mocks.composeLogs).toHaveBeenCalledWith('demo', 1000);

    const fallback = await request(buildApp()).get('/stacks/demo/logs?tail=abc');
    expect(fallback.status).toBe(200);
    expect(mocks.composeLogs).toHaveBeenCalledWith('demo', 100);

    const negative = await request(buildApp()).get('/stacks/demo/logs?tail=-5');
    expect(negative.status).toBe(200);
    expect(mocks.composeLogs).toHaveBeenCalledWith('demo', 1);

    const zero = await request(buildApp()).get('/stacks/demo/logs?tail=0');
    expect(zero.status).toBe(200);
    expect(mocks.composeLogs).toHaveBeenCalledWith('demo', 1);
  });

  it('supports lifecycle happy path up -> logs -> down', async () => {
    mocks.composeUp.mockResolvedValue('up-ok');
    mocks.composeLogs.mockResolvedValue('service booted\nready');
    mocks.composeDown.mockResolvedValue('down-ok');
    mocks.notifyStackAction.mockResolvedValue(undefined);

    const up = await request(buildApp()).post('/stacks/demo/up');
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ ok: true, output: 'up-ok' });

    const logs = await request(buildApp()).get('/stacks/demo/logs?tail=50');
    expect(logs.status).toBe(200);
    expect(logs.body.output).toContain('ready');
    expect(mocks.composeLogs).toHaveBeenCalledWith('demo', 50);

    const down = await request(buildApp()).post('/stacks/demo/down');
    expect(down.status).toBe(200);
    expect(down.body).toEqual({ ok: true, output: 'down-ok' });

    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'started', true);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'stopped', true);
  });

  it('returns stack images and handles image/log route errors', async () => {
    mocks.getStackImages.mockResolvedValueOnce(['nginx:latest']);
    const imagesOk = await request(buildApp()).get('/stacks/demo/images');
    expect(imagesOk.status).toBe(200);
    expect(imagesOk.body.images).toEqual(['nginx:latest']);

    mocks.getStackImages.mockRejectedValueOnce(new Error('images-failed'));
    const imagesFail = await request(buildApp()).get('/stacks/demo/images');
    expect(imagesFail.status).toBe(500);
    expect(imagesFail.body.error).toContain('images-failed');

    mocks.composeLogs.mockRejectedValueOnce(new Error('logs-failed'));
    const logsFail = await request(buildApp()).get('/stacks/demo/logs');
    expect(logsFail.status).toBe(500);
    expect(logsFail.body.error).toContain('logs-failed');
  });

  it('routes valid container logs through and rejects flag-like container names', async () => {
    mocks.composeContainerLogs.mockResolvedValue('container log line');

    const ok = await request(buildApp()).get('/stacks/demo/logs?container=web-1&tail=20');
    expect(ok.status).toBe(200);
    expect(ok.body.output).toContain('container log line');
    expect(mocks.composeContainerLogs).toHaveBeenCalledWith('demo', 'web-1', 20);

    const evil = await request(buildApp()).get('/stacks/demo/logs?container=--no-log-prefix');
    expect(evil.status).toBe(400);
    expect(evil.body.error).toContain('Invalid container name');
    // The flag-like value must never reach the docker layer.
    expect(mocks.composeContainerLogs).not.toHaveBeenCalledWith('demo', '--no-log-prefix', expect.anything());
  });
});
