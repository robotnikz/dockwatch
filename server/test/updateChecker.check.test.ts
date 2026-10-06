import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listStacks: vi.fn(),
  getComposeContent: vi.fn(),
  getStackEnv: vi.fn(),
  getStackImages: vi.fn(),
  getImageRepoDigests: vi.fn(),
  notifyUpdatesAvailable: vi.fn(),
}));

vi.mock('../src/services/docker.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/docker.js')>('../src/services/docker.js');
  return {
    hasTrueLabel: actual.hasTrueLabel,
    getComposeProcessEnv: () => ({ PATH: '/usr/bin' }),
    listStacks: mocks.listStacks,
    getComposeContent: mocks.getComposeContent,
    getStackEnv: mocks.getStackEnv,
    getStackImages: mocks.getStackImages,
    getImageRepoDigests: mocks.getImageRepoDigests,
  };
});

vi.mock('../src/services/discord.js', () => ({
  notifyUpdatesAvailable: mocks.notifyUpdatesAvailable,
}));

const checker = await import('../src/services/updateChecker.js');
const db = await import('../src/db.js');

const DIGEST_OLD = `sha256:${'a'.repeat(64)}`;
const DIGEST_NEW = `sha256:${'b'.repeat(64)}`;

function mockRegistry(digestByRepo: Record<string, string | null>) {
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'auth.docker.io') {
      return new Response(JSON.stringify({ token: 'hub-token' }), { status: 200 });
    }
    const repo = url.pathname.replace(/^\/v2\//, '').replace(/\/manifests\/.*$/, '');
    const digest = digestByRepo[repo];
    if (digest === undefined) return new Response(null, { status: 404, statusText: 'Not Found' });
    if (digest === null) return new Response(null, { status: 500, statusText: 'Server Error' });
    expect(init?.method).toBe('HEAD');
    return new Response(null, { status: 200, headers: { 'docker-content-digest': digest } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('update checker: helpers', () => {
  it('resolves compose variables like docker compose does', () => {
    const env = { TAG: '1.2', EMPTY: '', REG: 'ghcr.io' };
    expect(checker.resolveEnvVars('nginx:${TAG}', env)).toBe('nginx:1.2');
    expect(checker.resolveEnvVars('nginx:$TAG', env)).toBe('nginx:1.2');
    expect(checker.resolveEnvVars('nginx:${MISSING:-latest}', env)).toBe('nginx:latest');
    expect(checker.resolveEnvVars('nginx:${EMPTY:-latest}', env)).toBe('nginx:latest');
    expect(checker.resolveEnvVars('nginx:${EMPTY-latest}', env)).toBe('nginx:');
    expect(checker.resolveEnvVars('nginx:${TAG:?tag required}', env)).toBe('nginx:1.2');
    expect(checker.resolveEnvVars('${REG:+ghcr.io/}app', env)).toBe('ghcr.io/app');
    expect(checker.resolveEnvVars('${MISSING:+x}app', env)).toBe('app');
    expect(checker.resolveEnvVars('a$$b', env)).toBe('a$b');
  });

  it('does not fall back to the DockWatch process environment', () => {
    process.env.DOCKWATCH_TEST_ONLY_VAR = 'leak';
    expect(checker.resolveEnvVars('img:${DOCKWATCH_TEST_ONLY_VAR:-ok}', {})).toBe('img:ok');
    delete process.env.DOCKWATCH_TEST_ONLY_VAR;
  });

  it('matches local repo digests by repository', () => {
    const digests = [
      `lscr.io/linuxserver/freshrss@${DIGEST_OLD}`,
      `linuxserver/freshrss@${DIGEST_NEW}`,
      `ghcr.io/linuxserver/freshrss@sha256:${'c'.repeat(64)}`,
    ];
    expect(checker.matchRepoDigests('lscr.io/linuxserver/freshrss:latest', digests)).toEqual([DIGEST_OLD]);
    expect(checker.matchRepoDigests('linuxserver/freshrss', digests)).toEqual([DIGEST_NEW]);
    expect(checker.matchRepoDigests('docker.io/library/nginx:1', [`nginx@${DIGEST_OLD}`])).toEqual([DIGEST_OLD]);
    expect(checker.matchRepoDigests('nginx:1', ['broken-entry'])).toEqual([]);
  });

  it('reads registry credentials from a docker config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dockwatch-cfg-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
      auths: {
        'https://index.docker.io/v1/': { auth: 'aHViOnB3' },
        'registry.example.com': { username: 'u', password: 'p' },
      },
    }));

    expect(checker.getRegistryBasicAuth('registry-1.docker.io', file)).toBe('aHViOnB3');
    expect(checker.getRegistryBasicAuth('registry.example.com', file)).toBe(Buffer.from('u:p').toString('base64'));
    expect(checker.getRegistryBasicAuth('ghcr.io', file)).toBeNull();
    expect(checker.getRegistryBasicAuth('ghcr.io', path.join(dir, 'missing.json'))).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('update checker: checks', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    mocks.getStackEnv.mockResolvedValue({});
    mocks.notifyUpdatesAvailable.mockResolvedValue(undefined);
    db.pruneUpdateCache([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the registry for manifest lists and OCI indexes', async () => {
    const fetchMock = mockRegistry({ 'library/nginx': DIGEST_OLD });
    mocks.getImageRepoDigests.mockResolvedValue([`nginx@${DIGEST_OLD}`]);

    const result = await checker.checkImageUpdate('nginx:latest');

    expect(result).toMatchObject({ updateAvailable: false, checkFailed: false, localDigest: DIGEST_OLD });
    const manifestCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/manifests/'));
    const accept = String((manifestCall?.[1]?.headers as Record<string, string>).Accept);
    expect(accept).toContain('application/vnd.docker.distribution.manifest.list.v2+json');
    expect(accept).toContain('application/vnd.oci.image.index.v1+json');
    expect(accept).toContain('application/vnd.oci.image.manifest.v1+json');
    expect(accept).toContain('application/vnd.docker.distribution.manifest.v2+json');
  });

  it('reports an update only when the remote digest is not among the local repo digests', async () => {
    mockRegistry({ 'library/nginx': DIGEST_NEW });
    mocks.getImageRepoDigests.mockResolvedValue([`nginx@${DIGEST_OLD}`, `nginx@${DIGEST_NEW}`]);
    expect((await checker.checkImageUpdate('nginx:latest')).updateAvailable).toBe(false);

    mocks.getImageRepoDigests.mockResolvedValue([`nginx@${DIGEST_OLD}`, `mirror.example.com/nginx@${DIGEST_NEW}`]);
    expect((await checker.checkImageUpdate('nginx:latest')).updateAvailable).toBe(true);
  });

  it('marks images that cannot be compared as check failed', async () => {
    mockRegistry({ 'library/nginx': null });
    mocks.getImageRepoDigests.mockResolvedValue([`nginx@${DIGEST_OLD}`]);
    const registryDown = await checker.checkImageUpdate('nginx:latest');
    expect(registryDown).toMatchObject({ updateAvailable: false, checkFailed: true });

    mockRegistry({ 'library/nginx': DIGEST_NEW });
    mocks.getImageRepoDigests.mockResolvedValue(null);
    const notPulled = await checker.checkImageUpdate('nginx:latest');
    expect(notPulled).toMatchObject({ updateAvailable: false, checkFailed: true });

    const cached = checker.getCachedUpdates().find((row) => row.image === 'nginx:latest');
    expect(cached).toMatchObject({ updateAvailable: false, checkFailed: true });
  });

  it('resolves .env image variables, prunes stale cache rows and notifies each digest once', async () => {
    mocks.listStacks.mockResolvedValue(['adguard']);
    mocks.getComposeContent.mockResolvedValue('services:\n  adguard:\n    image: adguard/adguardhome:${ADGUARD_VERSION}\n');
    mocks.getStackEnv.mockResolvedValue({ ADGUARD_VERSION: 'v0.107.0' });
    mocks.getImageRepoDigests.mockResolvedValue([`adguard/adguardhome@${DIGEST_OLD}`]);
    mockRegistry({ 'adguard/adguardhome': DIGEST_NEW });
    db.setUpdateCache('removed/image:latest', DIGEST_OLD, DIGEST_OLD, 'gone/app', false);

    const first = await checker.checkAllUpdates();

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ image: 'adguard/adguardhome:v0.107.0', updateAvailable: true, context: 'adguard/adguard' });
    expect(mocks.notifyUpdatesAvailable).toHaveBeenCalledTimes(1);
    expect(checker.getCachedUpdates().map((row) => row.image)).toEqual(['adguard/adguardhome:v0.107.0']);

    // Same remote digest on the next run: no repeated notification.
    await checker.checkAllUpdates();
    expect(mocks.notifyUpdatesAvailable).toHaveBeenCalledTimes(1);

    // A newer remote digest is announced again.
    mockRegistry({ 'adguard/adguardhome': `sha256:${'d'.repeat(64)}` });
    await checker.checkAllUpdates();
    expect(mocks.notifyUpdatesAvailable).toHaveBeenCalledTimes(2);
  });

  it('skips services excluded from update checks', async () => {
    mocks.listStacks.mockResolvedValue(['app']);
    mocks.getComposeContent.mockResolvedValue([
      'services:',
      '  web:',
      '    image: nginx:latest',
      '    labels:',
      '      dockwatch.update.check.exclude: "true"',
      '',
    ].join('\n'));
    const fetchMock = mockRegistry({});

    expect(await checker.checkAllUpdates()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getImageRepoDigests).not.toHaveBeenCalled();
  });
});
