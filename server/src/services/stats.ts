import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ContainerStats {
  id: string;
  name: string;
  cpu_percent: number;
  mem_usage: string;
  mem_limit: string;
  mem_percent: number;
  net_io: string;
  block_io: string;
  pids: number;
}

/** Get live stats for all running containers (single snapshot) */
export async function getAllContainerStats(): Promise<ContainerStats[]> {
  const result = await execFileAsync('docker', [
    'stats', '--no-stream', '--format',
    '{{.ID}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}'
  ], { timeout: 15_000 });

  return result.stdout.trim().split('\n').filter(Boolean).map(line => {
    const [id, name, cpu, memUsage, memPerc, netIo, blockIo, pids] = line.split('\t');
    const [memUse, memLim] = (memUsage || '').split(' / ');
    return {
      id: id || '',
      name: (name || '').replace(/^\//, ''),
      cpu_percent: parseFloat((cpu || '0').replace('%', '')) || 0,
      mem_usage: (memUse || '0B').trim(),
      mem_limit: (memLim || '0B').trim(),
      mem_percent: parseFloat((memPerc || '0').replace('%', '')) || 0,
      net_io: netIo || '0B / 0B',
      block_io: blockIo || '0B / 0B',
      pids: parseInt(pids || '0') || 0,
    };
  });
}

/** Get host system info */
export async function getHostInfo(): Promise<{
  containers_running: number;
  containers_total: number;
  images: number;
  server_version: string;
  os: string;
  architecture: string;
  cpus: number;
  memory_total: string;
  memory_total_bytes: number;
}> {
  const result = await execFileAsync('docker', [
    'info', '--format',
    '{{.ContainersRunning}}\t{{.Containers}}\t{{.Images}}\t{{.ServerVersion}}\t{{.OperatingSystem}}\t{{.Architecture}}\t{{.NCPU}}\t{{.MemTotal}}'
  ], { timeout: 10_000 });

  const [running, total, images, version, os, arch, cpus, memTotal] = result.stdout.trim().split('\t');
  const memBytes = parseInt(memTotal || '0');
  const memGB = (memBytes / (1024 ** 3)).toFixed(1) + ' GiB';

  return {
    containers_running: parseInt(running || '0'),
    containers_total: parseInt(total || '0'),
    images: parseInt(images || '0'),
    server_version: version || 'unknown',
    os: os || 'unknown',
    architecture: arch || 'unknown',
    cpus: parseInt(cpus || '0'),
    memory_total: memGB,
    memory_total_bytes: memBytes,
  };
}
