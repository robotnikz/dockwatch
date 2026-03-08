import { performance } from 'node:perf_hooks';
import { parseImage } from '../dist/services/updateChecker.js';
import { setResourcesInYaml } from '../dist/services/resources.js';

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

const baseYaml = `services:\n  app:\n    image: nginx:latest\n`;

const results = [
  runBenchmark('parseImage', 20000, (i) => {
    parseImage(`ghcr.io/robotnikz/app-${i % 8}:v${(i % 5) + 1}.0.${i % 3}`);
  }),
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
];

console.log('Performance sanity results (lower is better):');
for (const result of results) {
  console.log(`- ${result.name}: ${result.duration.toFixed(2)}ms total, ${result.perOp.toFixed(4)}ms/op (${result.iterations} iterations)`);
}
