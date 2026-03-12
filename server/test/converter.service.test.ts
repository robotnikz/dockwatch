import { describe, expect, it } from 'vitest';
import { dockerRunToCompose } from '../src/services/converter.js';

describe('converter service logic', () => {
  it('converts a simple nginx command', () => {
    const cmd = 'docker run --name my-web -p 8080:80 nginx:latest';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('container_name: my-web');
    expect(result).toContain('image: nginx:latest');
    expect(result).toContain('- "8080:80"');
  });

  it('converts volumes correctly', () => {
    const cmd = 'docker run -v /host/path:/container/path:ro -v data_volume:/data nginx';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('- /host/path:/container/path:ro');
    expect(result).toContain('- data_volume:/data');
  });

  it('converts networks and adds top-level network section', () => {
    const cmd = 'docker run --network my-net --name test alpine';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('networks:');
    expect(result).toContain('  - my-net');
    expect(result).toContain('networks:\n  my-net:\n    external: true');
  });

  it('handles environment variables with quotes and equals', () => {
    const cmd = 'docker run -e MY_VAR="some value" -e OTHER=123 alpine';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('- MY_VAR=some value');
    expect(result).toContain('- OTHER=123');
  });

  it('converts complex mount commands', () => {
    const cmd = 'docker run --mount type=bind,source=/src,target=/app,readonly alpine';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('- /src:/app:ro');
  });

  it('adds top-level volumes for named volumes', () => {
    const cmd = 'docker run -v my_data:/data alpine';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('volumes:\n  my_data:\n    external: true');
  });

  it('handles resource limits in deploy section', () => {
    const cmd = 'docker run --memory 512m --cpus 0.5 alpine';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('deploy:');
    expect(result).toContain('resources:');
    expect(result).toContain('limits:');
    expect(result).toContain('memory: 512m');
    expect(result).toContain('cpus: "0.5"');
  });

  it('handles ulimits', () => {
    const cmd = 'docker run --ulimit nofile=1024:2048 --ulimit memlock=-1 alpine';
    const result = dockerRunToCompose(cmd);
    
    expect(result).toContain('ulimits:');
    expect(result).toContain('nofile:');
    expect(result).toContain('soft: 1024');
    expect(result).toContain('hard: 2048');
    expect(result).toContain('memlock: -1');
  });
});
