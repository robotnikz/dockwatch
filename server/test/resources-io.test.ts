import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getComposeContent: vi.fn<[], Promise<string>>(),
  saveComposeContent: vi.fn<[], Promise<void>>(),
}));

vi.mock('../src/services/docker.js', () => ({
  getComposeContent: mocks.getComposeContent,
  saveComposeContent: mocks.saveComposeContent,
}));

const resourcesModule = await import('../src/services/resources.js');

describe('resources io helpers', () => {
  beforeEach(() => {
    mocks.getComposeContent.mockReset();
    mocks.saveComposeContent.mockReset();
  });

  it('returns per-service resource map from compose content', async () => {
    mocks.getComposeContent.mockResolvedValue(`services:
  app:
    image: nginx:latest
    deploy:
      resources:
        limits:
          cpus: "1.0"
  worker:
    image: busybox:latest
`);

    const result = await resourcesModule.getStackResources('demo');

    expect(mocks.getComposeContent).toHaveBeenCalledWith('demo');
    expect(result.app?.limits_cpus).toBe('1.0');
    expect(result.worker).toBeDefined();
  });

  it('skips unsafe service keys while building resource map', async () => {
    mocks.getComposeContent.mockResolvedValue(`services:
  __proto__:
    image: busybox:latest
  safe:
    image: nginx:latest
`);

    const result = await resourcesModule.getStackResources('demo');

    expect(result.safe).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
  });

  it('updates and saves compose content for a service', async () => {
    mocks.getComposeContent.mockResolvedValue(`services:
  app:
    image: nginx:latest
`);
    mocks.saveComposeContent.mockResolvedValue();

    const updated = await resourcesModule.updateServiceResources('demo', 'app', {
      limits_memory: '256m',
      update_excluded: true,
    });

    expect(mocks.getComposeContent).toHaveBeenCalledWith('demo');
    expect(mocks.saveComposeContent).toHaveBeenCalledWith('demo', updated);
    expect(updated).toContain('memory: 256m');
    expect(updated).toContain('dockwatch.update.exclude: "true"');
  });
});
