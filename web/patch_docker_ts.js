const fs = require('fs');
const filePath = '/root/Github/dockwatch/server/src/services/docker.ts';
let content = fs.readFileSync(filePath, 'utf8');

const regex = /export async function saveComposeContent[^}]+}/;
const newFunctions = `export async function getEnvContent(name: string): Promise<string> {
  const dir = stackDir(name);
  const envPath = path.join(dir, '.env');
  try {
    return await fs.readFile(envPath, 'utf-8');
  } catch {
    return '';
  }
}

export async function saveEnvContent(name: string, content: string): Promise<void> {
  const dir = stackDir(name);
  await fs.mkdir(dir, { recursive: true });
  const envPath = path.join(dir, '.env');
  if (content.trim()) {
    await fs.writeFile(envPath, content, 'utf-8');
  } else {
    try { await fs.unlink(envPath); } catch {}
  }
}
`;

content = content.replace(/(export async function saveComposeContent[^}]+})/, `$1\n\n${newFunctions}`);
fs.writeFileSync(filePath, content);
