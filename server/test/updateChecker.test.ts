import { describe, expect, it } from 'vitest';
import { buildManifestUrl, isAllowedRegistryHost, parseImage } from '../src/services/updateChecker.js';

describe('update checker helpers', () => {
  it('parses docker hub short image references', () => {
    const parsed = parseImage('nginx:latest');
    expect(parsed.registry).toBe('registry-1.docker.io');
    expect(parsed.repo).toBe('library/nginx');
    expect(parsed.tag).toBe('latest');
  });

  it('parses explicit registry and custom tag', () => {
    const parsed = parseImage('ghcr.io/robotnikz/dockwatch:v1.2.3');
    expect(parsed.registry).toBe('ghcr.io');
    expect(parsed.repo).toBe('robotnikz/dockwatch');
    expect(parsed.tag).toBe('v1.2.3');
  });

  it('ignores digest suffix for digest-pinned references', () => {
    const parsed = parseImage('ghcr.io/robotnikz/dockwatch@sha256:abcdef');
    expect(parsed.registry).toBe('ghcr.io');
    expect(parsed.repo).toBe('robotnikz/dockwatch');
    expect(parsed.tag).toBe('latest');
  });

  it('accepts known registry hosts and blocks localhost variants', () => {
    expect(isAllowedRegistryHost('ghcr.io')).toBe(true);
    expect(isAllowedRegistryHost('registry-1.docker.io')).toBe(true);
    expect(isAllowedRegistryHost('localhost')).toBe(false);
    expect(isAllowedRegistryHost('localhost:5000')).toBe(false);
  });

  it('builds encoded registry manifest urls safely', () => {
    const url = buildManifestUrl('ghcr.io', 'robotnikz/my image', 'v1.0.0+meta');
    expect(url.toString()).toBe('https://ghcr.io/v2/robotnikz/my%20image/manifests/v1.0.0%2Bmeta');
  });
});
