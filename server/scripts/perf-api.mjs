import autocannon from 'autocannon';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

function runAutocannon(opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
    instance.on('error', reject);
  });
}

function fmtResult(label, result) {
  return {
    label,
    reqAvg: Number(result.requests.average || 0),
    reqP95: Number(result.requests.p95 || 0),
    latAvgMs: Number(result.latency.average || 0),
    latP95Ms: Number(result.latency.p95 || 0),
  };
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dockwatch-api-perf-'));
const dataDir = path.join(tempRoot, 'data');
const stacksDir = path.join(tempRoot, 'stacks');
const port = 3310;
const baseUrl = `http://127.0.0.1:${port}`;

const child = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    DOCKWATCH_DATA: dataDir,
    DOCKWATCH_STACKS: stacksDir,
    DOCKWATCH_VERSION: 'perf-bench',
    DOCKWATCH_REVISION: '0000000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let childOutput = '';
child.stdout.on('data', (d) => {
  childOutput += d.toString();
});
child.stderr.on('data', (d) => {
  childOutput += d.toString();
});

try {
  await waitForReady(`${baseUrl}/api/settings`);

  const common = {
    connections: 20,
    duration: 8,
    pipelining: 1,
  };

  const settingsRes = await runAutocannon({
    ...common,
    url: `${baseUrl}/api/settings`,
    method: 'GET',
  });

  const updatesRes = await runAutocannon({
    ...common,
    url: `${baseUrl}/api/updates`,
    method: 'GET',
  });

  const rows = [
    fmtResult('GET /api/settings', settingsRes),
    fmtResult('GET /api/updates', updatesRes),
  ];

  console.log('API performance sanity results (higher req/s is better, lower latency is better):');
  for (const row of rows) {
    console.log(`- ${row.label}: req/s avg=${row.reqAvg.toFixed(2)}, req/s p95=${row.reqP95.toFixed(2)}, latency avg=${row.latAvgMs.toFixed(2)}ms, latency p95=${row.latP95Ms.toFixed(2)}ms`);
  }
} finally {
  child.kill('SIGTERM');
  await sleep(250);
  if (!child.killed) {
    child.kill('SIGKILL');
  }
  await rm(tempRoot, { recursive: true, force: true });

  if (childOutput.trim()) {
    console.log('Server log excerpt during benchmark:');
    console.log(childOutput.split('\n').slice(-10).join('\n'));
  }
}
