import { describe, expect, it } from 'vitest';
import { getResourcesFromYaml, setResourcesInYaml } from '../src/services/resources.js';

const BASE_YAML = `services:
  app:
    image: nginx:latest
`;

describe('resources service', () => {
  it('reads service-level and deploy limits consistently', () => {
    const yaml = `services:
  app:
    image: nginx:latest
    cpus: "1.5"
    mem_limit: 512m
    mem_reservation: 256m
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 1g
        reservations:
          cpus: "0.5"
          memory: 128m
`;

    const cfg = getResourcesFromYaml(yaml, 'app');
    expect(cfg.limits_cpus).toBe('2.0');
    expect(cfg.limits_memory).toBe('1g');
    expect(cfg.reservations_cpus).toBe('0.5');
    expect(cfg.reservations_memory).toBe('128m');
  });

  it('writes canonical deploy.resources and compatible service-level fields', () => {
    const out = setResourcesInYaml(BASE_YAML, 'app', {
      limits_cpus: '1.0',
      limits_memory: '512m',
      reservations_cpus: '0.5',
      reservations_memory: '256m',
      update_excluded: false,
      update_check_excluded: false,
    });

    expect(out).toContain('deploy:');
    expect(out).toContain('resources:');
    expect(out).toContain('limits:');
    expect(out).toContain('cpus: "1.0"');
    expect(out).toContain('memory: 512m');
    expect(out).toContain('reservations:');
    expect(out).toContain('mem_limit: 512m');
    expect(out).toContain('mem_reservation: 256m');
  });

  it('removes limits and reservations fields when values are cleared', () => {
    const withValues = `services:
  app:
    image: nginx:latest
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512m
        reservations:
          cpus: "0.5"
          memory: 256m
`;

    const out = setResourcesInYaml(withValues, 'app', {
      limits_cpus: '',
      limits_memory: '',
      reservations_cpus: '',
      reservations_memory: '',
      update_excluded: false,
      update_check_excluded: false,
    });

    expect(out).not.toContain('limits:');
    expect(out).not.toContain('reservations:');
    expect(out).not.toContain('mem_limit:');
    expect(out).not.toContain('mem_reservation:');
  });

  it('toggles update exclusion labels for map labels', () => {
    const yaml = `services:
  app:
    image: nginx:latest
    labels:
      com.example.keep: "true"
`;

    const out = setResourcesInYaml(yaml, 'app', {
      update_excluded: true,
      update_check_excluded: true,
    });

    expect(out).toContain('dockwatch.update.exclude: "true"');
    expect(out).toContain('dockwatch.update.check.exclude: "true"');
    expect(out).toContain('com.example.keep: "true"');
  });

  it('toggles update exclusion labels for array labels', () => {
    const yaml = `services:
  app:
    image: nginx:latest
    labels:
      - com.example.keep=true
      - dockwatch.update.exclude=true
      - dockwatch.update.check.exclude=true
`;

    const out = setResourcesInYaml(yaml, 'app', {
      update_excluded: false,
      update_check_excluded: false,
    });

    expect(out).toContain('- com.example.keep=true');
    expect(out).not.toContain('dockwatch.update.exclude=true');
    expect(out).not.toContain('dockwatch.update.check.exclude=true');
  });

  it('rejects unsafe service names to prevent prototype pollution', () => {
    expect(() => setResourcesInYaml(BASE_YAML, '__proto__', { limits_cpus: '1' })).toThrow('Invalid service name');
    expect(getResourcesFromYaml(BASE_YAML, '__proto__')).toEqual({});
  });

  it('drops forbidden label keys while preserving safe keys', () => {
    const yaml = `services:
  app:
    image: nginx:latest
    labels:
      constructor: bad
      prototype: bad
      __proto__: bad
      keep: "yes"
`;

    const out = setResourcesInYaml(yaml, 'app', {
      update_excluded: true,
      update_check_excluded: true,
    });

    expect(out).toContain('keep:');
    expect(out).not.toContain('constructor:');
    expect(out).not.toContain('prototype:');
    expect(out).not.toContain('__proto__:');
    expect(out).toContain('dockwatch.update.exclude: "true"');
    expect(out).toContain('dockwatch.update.check.exclude: "true"');
  });

  it('returns empty config for missing services', () => {
    expect(getResourcesFromYaml(BASE_YAML, 'missing')).toEqual({});
  });
});
