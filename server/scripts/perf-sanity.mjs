import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';

function runBenchmark(name, iterations, fn) {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn(i);
  }
  const end = performance.now();
  const duration = end - start;
  const perOp = duration / iterations;
  return { name, iterations, duration, perOp };
}

async function runBenchmarkAsync(name, iterations, fn) {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    await fn(i);
  }
  const end = performance.now();
  const duration = end - start;
  const perOp = duration / iterations;
  return { name, iterations, duration, perOp };
}

const baseYaml = `services:\n  app:\n    image: nginx:latest\n`;
const results = [];

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dockwatch-perf-'));
try {
  const stacksRoot = path.join(tempRoot, 'stacks');
  const stackName = 'bench';
  const stackDir = path.join(stacksRoot, stackName);
  await mkdir(stackDir, { recursive: true });
  process.env.DOCKWATCH_STACKS = stacksRoot;

  const { parseImage } = await import('../dist/services/updateChecker.js');
  const { setResourcesInYaml, getStackResources } = await import('../dist/services/resources.js');

  results.push(
    runBenchmark('parseImage', 20000, (i) => {
      parseImage(`ghcr.io/robotnikz/app-${i % 8}:v${(i % 5) + 1}.0.${i % 3}`);
    }),
  );

  results.push(
    runBenchmark('setResourcesInYaml', 2000, (i) => {
      setResourcesInYaml(baseYaml, 'app', {
        limits_cpus: `${1 + (i % 2)}`,
        limits_memory: i % 2 === 0 ? '512m' : '1g',
        reservations_cpus: '0.5',
        reservations_memory: '256m',
        update_excluded: i % 2 === 0,
        update_check_excluded: i % 3 === 0,
      });
    }),
  );

  const services = [];
  for (let i = 0; i < 60; i += 1) {
    services.push(`  svc${i}:\n    image: nginx:latest\n    deploy:\n      resources:\n        limits:\n          cpus: \"1.0\"\n          memory: 512m\n        reservations:\n          memory: 256m`);
  }
  await writeFile(path.join(stackDir, 'compose.yaml'), `services:\n${services.join('\n')}`);

  results.push(
    await runBenchmarkAsync('getStackResources(60 services)', 200, async () => {
      await getStackResources(stackName);
    }),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('Performance sanity results (lower is better):');
for (const result of results) {
  console.log(`- ${result.name}: ${result.duration.toFixed(2)}ms total, ${result.perOp.toFixed(4)}ms/op (${result.iterations} iterations)`);
}
