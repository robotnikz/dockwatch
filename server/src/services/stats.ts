import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as yaml from 'yaml';
import { getComposeContent, listStacks } from './docker.js';

const execFileAsync = promisify(execFile);

async function getStackContainerCounts(): Promise<{ running: number; total: number }> {
  const stacks = await listStacks();
  if (stacks.length === 0) {
    return { running: 0, total: 0 };
  }

  let total = 0;
  for (const stack of stacks) {
    try {
      const content = await getComposeContent(stack);
      const doc = yaml.parse(content) as { services?: Record<string, unknown> } | null;
      if (doc?.services && typeof doc.services === 'object') {
        total += Object.keys(doc.services).length;
      }
    } catch {
      // Ignore invalid/missing compose files for count aggregation.
    }
  }

  let running = 0;
  try {
    const ps = await execFileAsync('docker', ['ps', '--format', '{{.Label "com.docker.compose.project"}}'], {
      timeout: 10_000,
    });
    const stackSet = new Set(stacks);
    running = ps.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((project) => project.length > 0 && stackSet.has(project)).length;
  } catch {
    // Keep running at 0 if docker ps fails.
  }

  return { running, total };
}

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
  stack_containers_running: number;
  stack_containers_total: number;
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
  const stackCounts = await getStackContainerCounts();

  return {
    containers_running: parseInt(running || '0'),
    containers_total: parseInt(total || '0'),
    stack_containers_running: stackCounts.running,
    stack_containers_total: stackCounts.total,
    images: parseInt(images || '0'),
    server_version: version || 'unknown',
    os: os || 'unknown',
    architecture: arch || 'unknown',
    cpus: parseInt(cpus || '0'),
    memory_total: memGB,
    memory_total_bytes: memBytes,
  };
}
