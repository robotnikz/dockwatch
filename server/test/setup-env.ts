import fs from 'node:fs';
import path from 'node:path';

const testRoot = path.resolve(process.cwd(), '.vitest-runtime');
const dataDir = path.join(testRoot, 'data');
const stacksDir = path.join(testRoot, 'stacks');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(stacksDir, { recursive: true });

process.env.DOCKWATCH_DATA = process.env.DOCKWATCH_DATA || dataDir;
process.env.DOCKWATCH_STACKS = process.env.DOCKWATCH_STACKS || stacksDir;
