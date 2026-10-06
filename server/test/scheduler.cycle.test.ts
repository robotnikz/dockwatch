import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAllUpdates: vi.fn(),
  getStackInterpolationEnv: vi.fn(),
  composePullAndRecreate: vi.fn(),
  getComposeContent: vi.fn(),
  listStacks: vi.fn(),
  getSetting: vi.fn(),
  insertSchedulerEvent: vi.fn(),
  notifySchedulerError: vi.fn(),
  notifyStackAction: vi.fn(),
}));

vi.mock('../src/services/updateChecker.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/updateChecker.js')>('../src/services/updateChecker.js');
  return {
    resolveEnvVars: actual.resolveEnvVars,
    checkAllUpdates: mocks.checkAllUpdates,
    getStackInterpolationEnv: mocks.getStackInterpolationEnv,
  };
});

vi.mock('../src/services/docker.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/docker.js')>('../src/services/docker.js');
  return {
    hasTrueLabel: actual.hasTrueLabel,
    composePullAndRecreate: mocks.composePullAndRecreate,
    getComposeContent: mocks.getComposeContent,
    listStacks: mocks.listStacks,
  };
});

vi.mock('../src/db.js', () => ({
  getSetting: mocks.getSetting,
  insertSchedulerEvent: mocks.insertSchedulerEvent,
}));

vi.mock('../src/services/discord.js', () => ({
  notifySchedulerError: mocks.notifySchedulerError,
  notifyStackAction: mocks.notifyStackAction,
}));

const scheduler = await import('../src/services/scheduler.js');

const update = (image: string) => ({ image, localDigest: 'a', remoteDigest: 'b', updateAvailable: true, checkFailed: false });

describe('scheduler update cycle', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    mocks.getSetting.mockReturnValue(undefined);
    mocks.getStackInterpolationEnv.mockResolvedValue({});
    mocks.composePullAndRecreate.mockResolvedValue('ok');
    mocks.listStacks.mockResolvedValue(['web']);
    mocks.getComposeContent.mockResolvedValue('services:\n  app:\n    image: nginx:latest\n  db:\n    image: postgres:16\n');
  });

  it('applies updates only to services whose image changed', async () => {
    mocks.checkAllUpdates.mockResolvedValue([update('nginx:latest')]);

    await scheduler.runUpdateCycle();

    expect(mocks.composePullAndRecreate).toHaveBeenCalledWith('web', ['app']);
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('web', 'auto-updated (app)', true);
  });

  it('only checks during the startup run', async () => {
    mocks.checkAllUpdates.mockResolvedValue([update('nginx:latest')]);

    await scheduler.runUpdateCycle({ applyUpdates: false });

    expect(mocks.checkAllUpdates).toHaveBeenCalledTimes(1);
    expect(mocks.composePullAndRecreate).not.toHaveBeenCalled();
  });

  it('does not apply updates when auto-update is disabled in settings', async () => {
    mocks.getSetting.mockImplementation((key: string) => (key === 'auto_update_enabled' ? 'false' : undefined));
    mocks.checkAllUpdates.mockResolvedValue([update('nginx:latest')]);

    await scheduler.runUpdateCycle();

    expect(scheduler.isAutoUpdateEnabled()).toBe(false);
    expect(mocks.composePullAndRecreate).not.toHaveBeenCalled();
  });

  it('matches images that use .env variables', async () => {
    mocks.getComposeContent.mockResolvedValue('services:\n  adguard:\n    image: adguard/adguardhome:${ADGUARD_VERSION}\n');
    mocks.getStackInterpolationEnv.mockResolvedValue({ ADGUARD_VERSION: 'v0.107.0' });
    mocks.checkAllUpdates.mockResolvedValue([update('adguard/adguardhome:v0.107.0')]);

    await scheduler.runUpdateCycle();

    expect(mocks.composePullAndRecreate).toHaveBeenCalledWith('web', ['adguard']);
  });

  it('does not notify when nothing was running to update', async () => {
    mocks.checkAllUpdates.mockResolvedValue([update('nginx:latest')]);
    mocks.composePullAndRecreate.mockResolvedValue('[Dockwatch] No running, non-excluded services to update.\n');

    await scheduler.runUpdateCycle();

    expect(mocks.notifyStackAction).not.toHaveBeenCalled();
  });

  it('records stack failures and keeps going with other stacks', async () => {
    mocks.listStacks.mockResolvedValue(['broken', 'web']);
    mocks.checkAllUpdates.mockResolvedValue([update('nginx:latest')]);
    mocks.composePullAndRecreate
      .mockRejectedValueOnce(new Error('pull failed'))
      .mockResolvedValueOnce('ok');

    await scheduler.runUpdateCycle();

    expect(mocks.composePullAndRecreate).toHaveBeenCalledTimes(2);
    expect(mocks.insertSchedulerEvent).toHaveBeenCalledWith(expect.objectContaining({ scope: 'broken', message: 'pull failed' }));
    expect(mocks.notifySchedulerError).toHaveBeenCalledWith('update-scheduler', 'pull failed', 'broken');
  });

  it('returns the auto-update candidates of a compose file', () => {
    const compose = [
      'services:',
      '  app:',
      '    image: nginx:${TAG:-latest}',
      '  pinned:',
      '    image: nginx:latest',
      '    labels: ["dockwatch.update.exclude=true"]',
      '  other:',
      '    image: redis:7',
      '',
    ].join('\n');

    expect(scheduler.getAutoUpdateServices(compose, new Set(['nginx:latest']))).toEqual(['app']);
    expect(scheduler.getAutoUpdateServices(compose, new Set(['nginx:latest']), { TAG: '1.27' })).toEqual([]);
    expect(scheduler.getAutoUpdateServices('not: [valid', new Set(['nginx:latest']))).toEqual([]);
  });
});
