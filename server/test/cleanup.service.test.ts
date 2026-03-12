import { describe, expect, it } from 'vitest';
import { countDeletedImageReferences } from '../src/services/cleanup.js';

describe('cleanup service image deletion counting', () => {
  it('counts only untagged image references and ignores raw sha layer-like rows', () => {
    const output = [
      'Deleted Images:',
      'untagged: ghcr.io/robotnikz/demo:latest',
      'deleted: sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'untagged: sha256:2222222222222222222222222222222222222222222222222222222222222222',
      'untagged: ghcr.io/robotnikz/demo@sha256:3333333333333333333333333333333333333333333333333333333333333333',
      'untagged: ghcr.io/robotnikz/demo:latest',
      'Total reclaimed space: 120MB',
    ].join('\n');

    expect(countDeletedImageReferences(output)).toBe(2);
  });

  it('counts untagged digest references as deleted image refs', () => {
    const output = [
      'Deleted Images:',
      'untagged: ghcr.io/robotnikz/dockwatch@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'deleted: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'untagged: ghcr.io/robotnikz/rt1mil@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'Total reclaimed space: 668.8MB',
    ].join('\n');

    expect(countDeletedImageReferences(output)).toBe(2);
  });

  it('returns zero for missing or empty deleted images section', () => {
    expect(countDeletedImageReferences('Total reclaimed space: 0B')).toBe(0);
    expect(countDeletedImageReferences('Deleted Images:\n\nTotal reclaimed space: 0B')).toBe(0);
  });
});
