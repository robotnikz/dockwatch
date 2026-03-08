import { describe, expect, it } from 'vitest';
import { hasAutoUpdateEnabledServiceWithUpdates } from '../src/services/scheduler.js';

describe('scheduler auto-update selection', () => {
  it('returns true when updated image exists and service is not excluded', () => {
    const compose = `services:
  app:
    image: nginx:latest
`;

    const result = hasAutoUpdateEnabledServiceWithUpdates(compose, new Set(['nginx:latest']));
    expect(result).toBe(true);
  });

  it('returns false when service has dockwatch.update.exclude=true in map labels', () => {
    const compose = `services:
  app:
    image: nginx:latest
    labels:
      dockwatch.update.exclude: "true"
`;

    const result = hasAutoUpdateEnabledServiceWithUpdates(compose, new Set(['nginx:latest']));
    expect(result).toBe(false);
  });

  it('returns false when service has dockwatch.update.exclude=true in array labels', () => {
    const compose = `services:
  app:
    image: nginx:latest
    labels:
      - dockwatch.update.exclude=true
`;

    const result = hasAutoUpdateEnabledServiceWithUpdates(compose, new Set(['nginx:latest']));
    expect(result).toBe(false);
  });

  it('returns false when compose parsing fails', () => {
    const result = hasAutoUpdateEnabledServiceWithUpdates('not: [valid', new Set(['nginx:latest']));
    expect(result).toBe(false);
  });

  it('returns false when updated images set does not include service image', () => {
    const compose = `services:
  app:
    image: nginx:latest
`;

    const result = hasAutoUpdateEnabledServiceWithUpdates(compose, new Set(['busybox:latest']));
    expect(result).toBe(false);
  });
});
