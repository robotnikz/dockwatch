/** Parse a `docker run` command into a compose.yaml string */
export function dockerRunToCompose(command: string): string {
  const trimmed = command.trim();
  // Remove leading "docker run" or "docker container run"
  let args = trimmed
    .replace(/^docker\s+container\s+run\s+/, '')
    .replace(/^docker\s+run\s+/, '');

  if (!args || args === trimmed) {
    throw new Error('Input must start with "docker run" or "docker container run"');
  }

  const tokens = tokenize(args);

  let image = '';
  let containerName = '';
  const ports: string[] = [];
  const volumes: string[] = [];
  const envVars: string[] = [];
  const labels: string[] = [];
  const networks: string[] = [];
  let restart = '';
  let hostname = '';
  let user = '';
  let workdir = '';
  let entrypoint = '';
  const extraCmd: string[] = [];
  const capAdd: string[] = [];
  const capDrop: string[] = [];
  const devices: string[] = [];
  const dnsServers: string[] = [];
  let privileged = false;
  let readOnly = false;
  let interactive = false;
  let tty = false;
  const tmpfs: string[] = [];
  let pid = '';
  let networkMode = '';
  const sysctls: Record<string, string> = {};
  const ulimits: Record<string, string> = {};
  const cpus: string | undefined = undefined;
  let memLimit = '';
  let cpuShares = '';
  let cpusetCpus = '';
  const extraDeploy: Record<string, unknown> = {};

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (t === '-p' || t === '--publish') {
      ports.push(tokens[++i]);
    } else if (t.startsWith('-p=') || t.startsWith('--publish=')) {
      ports.push(t.split('=', 2)[1]);
    } else if (t === '-v' || t === '--volume') {
      const val = tokens[++i];
      if (!val.includes(':') && !val.startsWith('/')) {
        // Assume named volume if no path separators
        volumes.push(val);
      } else {
        volumes.push(val);
      }
    } else if (t.startsWith('-v=') || t.startsWith('--volume=')) {
      volumes.push(t.split('=', 2)[1]);
    } else if (t === '--mount') {
      const val = tokens[++i];
      // Basic --mount type=bind,source=...,target=... conversion attempt
      if (val.includes('source=') && val.includes('target=')) {
        const parts = val.split(',');
        const source = parts.find(p => p.startsWith('source='))?.split('=')[1];
        const target = parts.find(p => p.startsWith('target='))?.split('=')[1];
        const readOnlyPart = parts.find(p => p === 'readonly' || p === 'ro');
        if (source && target) {
          volumes.push(`${source}:${target}${readOnlyPart ? ':ro' : ''}`);
        } else {
          volumes.push(val);
        }
      } else {
        volumes.push(val);
      }
    } else if (t === '-e' || t === '--env') {
      envVars.push(tokens[++i]);
    } else if (t.startsWith('-e=') || t.startsWith('--env=')) {
      envVars.push(t.split('=', 2)[1]);
    } else if (t === '--env-file') {
      envVars.push(`# env_file: ${tokens[++i]}`);
    } else if (t === '--name') {
      containerName = tokens[++i];
    } else if (t.startsWith('--name=')) {
      containerName = t.split('=', 2)[1];
    } else if (t === '--restart') {
      restart = tokens[++i];
    } else if (t.startsWith('--restart=')) {
      restart = t.split('=', 2)[1];
    } else if (t === '-h' || t === '--hostname') {
      hostname = tokens[++i];
    } else if (t.startsWith('--hostname=')) {
      hostname = t.split('=', 2)[1];
    } else if (t === '-u' || t === '--user') {
      user = tokens[++i];
    } else if (t.startsWith('--user=')) {
      user = t.split('=', 2)[1];
    } else if (t === '-w' || t === '--workdir') {
      workdir = tokens[++i];
    } else if (t.startsWith('--workdir=')) {
      workdir = t.split('=', 2)[1];
    } else if (t === '--entrypoint') {
      entrypoint = tokens[++i];
    } else if (t.startsWith('--entrypoint=')) {
      entrypoint = t.split('=', 2)[1];
    } else if (t === '--network' || t === '--net') {
      const val = tokens[++i];
      if (val === 'host' || val === 'none' || val === 'bridge' || val.startsWith('container:')) {
        networkMode = val;
      } else {
        networks.push(val);
      }
    } else if (t.startsWith('--network=') || t.startsWith('--net=')) {
      const val = t.split('=', 2)[1];
      if (val === 'host' || val === 'none' || val === 'bridge' || val.startsWith('container:')) {
        networkMode = val;
      } else {
        networks.push(val);
      }
    } else if (t === '-l' || t === '--label') {
      labels.push(tokens[++i]);
    } else if (t.startsWith('--label=')) {
      labels.push(t.split('=', 2)[1]);
    } else if (t === '--cap-add') {
      capAdd.push(tokens[++i]);
    } else if (t.startsWith('--cap-add=')) {
      capAdd.push(t.split('=', 2)[1]);
    } else if (t === '--cap-drop') {
      capDrop.push(tokens[++i]);
    } else if (t.startsWith('--cap-drop=')) {
      capDrop.push(t.split('=', 2)[1]);
    } else if (t === '--device') {
      devices.push(tokens[++i]);
    } else if (t.startsWith('--device=')) {
      devices.push(t.split('=', 2)[1]);
    } else if (t === '--dns') {
      dnsServers.push(tokens[++i]);
    } else if (t.startsWith('--dns=')) {
      dnsServers.push(t.split('=', 2)[1]);
    } else if (t === '--privileged') {
      privileged = true;
    } else if (t === '--read-only') {
      readOnly = true;
    } else if (t === '--tmpfs') {
      tmpfs.push(tokens[++i]);
    } else if (t.startsWith('--tmpfs=')) {
      tmpfs.push(t.split('=', 2)[1]);
    } else if (t === '--pid') {
      pid = tokens[++i];
    } else if (t.startsWith('--pid=')) {
      pid = t.split('=', 2)[1];
    } else if (t === '--sysctl') {
      const [k, v] = tokens[++i].split('=', 2);
      sysctls[k] = v || '';
    } else if (t.startsWith('--sysctl=')) {
      const [k, v] = t.split('=', 2)[1].split('=', 2);
      sysctls[k] = v || '';
    } else if (t === '--ulimit') {
      const val = tokens[++i];
      const [uName, ...uRest] = val.split('=');
      ulimits[uName] = uRest.join('=');
    } else if (t === '--memory' || t === '-m') {
      memLimit = tokens[++i];
    } else if (t.startsWith('--memory=') || t.startsWith('-m=')) {
      memLimit = t.split('=', 2)[1];
    } else if (t === '--cpus') {
      extraDeploy['cpus'] = tokens[++i];
    } else if (t.startsWith('--cpus=')) {
      extraDeploy['cpus'] = t.split('=', 2)[1];
    } else if (t === '--cpu-shares' || t === '-c') {
      cpuShares = tokens[++i];
    } else if (t === '--cpuset-cpus') {
      cpusetCpus = tokens[++i];
    } else if (t === '-d' || t === '--detach') {
      // skip, compose always detaches
    } else if (t === '--rm') {
      // skip
    } else if (t === '-i' || t === '--interactive') {
      interactive = true;
    } else if (t === '-t' || t === '--tty') {
      tty = true;
    } else if (t === '-it' || t === '-ti') {
      interactive = true;
      tty = true;
    } else if (t.startsWith('-') && !t.startsWith('--') && t.length > 2) {
      // Combined short flags like -dit
      const flags = t.slice(1);
      for (const f of flags) {
        if (f === 'd') { /* skip detach */ }
        else if (f === 'i') interactive = true;
        else if (f === 't') tty = true;
      }
    } else if (!t.startsWith('-')) {
      // First non-flag is the image, rest is the command
      image = t;
      extraCmd.push(...tokens.slice(i + 1));
      break;
    }
    i++;
  }

  if (!image) {
    throw new Error('Could not determine image name from command');
  }

  // Build YAML
  const serviceName = containerName || image.split('/').pop()?.split(':')[0] || 'app';
  const lines: string[] = ['services:', `  ${serviceName}:`];
  const indent = '    ';

  if (containerName) lines.push(`${indent}container_name: ${containerName}`);
  lines.push(`${indent}image: ${image}`);
  if (restart) lines.push(`${indent}restart: ${restart}`);
  if (hostname) lines.push(`${indent}hostname: ${hostname}`);
  if (user) lines.push(`${indent}user: "${user}"`);
  if (workdir) lines.push(`${indent}working_dir: ${workdir}`);
  if (entrypoint) lines.push(`${indent}entrypoint: ${entrypoint}`);
  if (networkMode) lines.push(`${indent}network_mode: ${networkMode}`);
  if (privileged) lines.push(`${indent}privileged: true`);
  if (readOnly) lines.push(`${indent}read_only: true`);
  if (interactive) lines.push(`${indent}stdin_open: true`);
  if (tty) lines.push(`${indent}tty: true`);
  if (pid) lines.push(`${indent}pid: ${pid}`);

  if (ports.length) {
    lines.push(`${indent}ports:`);
    ports.forEach(p => lines.push(`${indent}  - "${p}"`));
  }
  if (volumes.length) {
    lines.push(`${indent}volumes:`);
    volumes.forEach(v => lines.push(`${indent}  - ${v}`));
  }
  if (envVars.length) {
    lines.push(`${indent}environment:`);
    envVars.forEach(e => lines.push(`${indent}  - ${e}`));
  }
  if (labels.length) {
    lines.push(`${indent}labels:`);
    labels.forEach(l => {
      const [k, ...vParts] = l.split('=');
      lines.push(`${indent}  ${k}: "${vParts.join('=')}"`);
    });
  }
  if (networks.length) {
    lines.push(`${indent}networks:`);
    networks.forEach(n => lines.push(`${indent}  - ${n}`));
  }
  if (capAdd.length) {
    lines.push(`${indent}cap_add:`);
    capAdd.forEach(c => lines.push(`${indent}  - ${c}`));
  }
  if (capDrop.length) {
    lines.push(`${indent}cap_drop:`);
    capDrop.forEach(c => lines.push(`${indent}  - ${c}`));
  }
  if (devices.length) {
    lines.push(`${indent}devices:`);
    devices.forEach(d => lines.push(`${indent}  - ${d}`));
  }
  if (dnsServers.length) {
    lines.push(`${indent}dns:`);
    dnsServers.forEach(d => lines.push(`${indent}  - ${d}`));
  }
  if (tmpfs.length) {
    lines.push(`${indent}tmpfs:`);
    tmpfs.forEach(t => lines.push(`${indent}  - ${t}`));
  }
  if (Object.keys(sysctls).length) {
    lines.push(`${indent}sysctls:`);
    for (const [k, v] of Object.entries(sysctls)) {
      lines.push(`${indent}  ${k}: "${v}"`);
    }
  }
  if (Object.keys(ulimits).length) {
    lines.push(`${indent}ulimits:`);
    for (const [name, val] of Object.entries(ulimits)) {
      if (val.includes(':')) {
        const [soft, hard] = val.split(':');
        lines.push(`${indent}  ${name}:`);
        lines.push(`${indent}    soft: ${soft}`);
        lines.push(`${indent}    hard: ${hard}`);
      } else {
        lines.push(`${indent}  ${name}: ${val}`);
      }
    }
  }

  if (extraCmd.length) {
    lines.push(`${indent}command: ${extraCmd.join(' ')}`);
  }

  // Resources (deploy section)
  const hasResources = memLimit || extraDeploy['cpus'] || cpuShares || cpusetCpus;
  if (hasResources) {
    lines.push(`${indent}deploy:`);
    lines.push(`${indent}  resources:`);
    lines.push(`${indent}    limits:`);
    if (extraDeploy['cpus']) lines.push(`${indent}      cpus: "${extraDeploy['cpus']}"`);
    if (memLimit) lines.push(`${indent}      memory: ${memLimit}`);
    if (cpuShares) lines.push(`${indent}    # cpu_shares: ${cpuShares} (use cpus instead)`);
  }

  // Top-level networks
  if (networks.length) {
    lines.push('');
    lines.push('networks:');
    networks.forEach(n => {
      lines.push(`  ${n}:`);
      lines.push(`    external: true`);
    });
  }

  const namedVolumes = volumes.filter(v => {
    if (!v.includes(':')) return false;
    const hostSide = v.split(':')[0];
    return !hostSide.includes('/') && !hostSide.includes('\\') && !hostSide.startsWith('.') && hostSide !== '';
  });
  if (namedVolumes.length) {
    lines.push('');
    lines.push('volumes:');
    const seen = new Set<string>();
    namedVolumes.forEach(v => {
      const name = v.split(':')[0];
      if (!seen.has(name)) {
        lines.push(`  ${name}:`);
        lines.push(`    external: true`);
        seen.add(name);
      }
    });
  }

  lines.push('');
  return lines.join('\n');
}

/** Tokenize respecting quotes */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '\'' | '"' | null = null;
  let escape = false;

  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\' && inQuote !== "'") {
      escape = true;
      continue;
    }
    if ((ch === '"' || ch === "'") && !inQuote) {
      inQuote = ch;
      continue;
    }
    if (ch === inQuote) {
      inQuote = null;
      continue;
    }
    if (ch === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}
