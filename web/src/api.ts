const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

// ---- Stacks ----
export interface StackService {
  Name: string;
  Service: string;
  State: string;
  Status: string;
}

export interface Stack {
  name: string;
  status: 'running' | 'partial' | 'stopped' | 'unknown';
  services: StackService[];
}

export interface StackDetail {
  name: string;
  content: string;
  envContent?: string;
}

export const getStacks = () => request<Stack[]>('/stacks');
export const getStack = (name: string) => request<StackDetail>(`/stacks/${name}`);
export const saveStack = (name: string, content: string, envContent?: string) =>
  request<{ ok: boolean }>(`/stacks/${name}`, { method: 'PUT', body: JSON.stringify({ content, envContent }) });
export const deleteStack = (name: string) =>
  request<{ ok: boolean }>(`/stacks/${name}`, { method: 'DELETE' });

export const stackUp = (name: string) =>
  request<{ ok: boolean; output: string }>(`/stacks/${name}/up`, { method: 'POST' });
export const stackDown = (name: string) =>
  request<{ ok: boolean; output: string }>(`/stacks/${name}/down`, { method: 'POST' });
export const stackRestart = (name: string) =>
  request<{ ok: boolean; output: string }>(`/stacks/${name}/restart`, { method: 'POST' });
export const stackUpdate = (name: string) =>
  request<{ ok: boolean; output: string }>(`/stacks/${name}/update`, { method: 'POST' });
export const stackLogs = (name: string, tail = 100) =>
  request<{ output: string }>(`/stacks/${name}/logs?tail=${tail}`);

// ---- Updates ----
export interface UpdateStatus {
  image: string;
  local_digest: string | null;
  remote_digest: string | null;
  checked_at: string;
  updateAvailable: boolean;
}

export const getUpdates = () => request<UpdateStatus[]>('/updates');
export const triggerCheck = () => request<UpdateStatus[]>('/updates/check', { method: 'POST' });

// ---- Settings ----
export const getSettings = () => request<Record<string, string>>('/settings');
export const saveSettings = (data: Record<string, string>) =>
  request<{ ok: boolean }>('/settings', { method: 'PUT', body: JSON.stringify(data) });
export const testWebhook = () => request<{ ok: boolean }>('/settings/test-webhook', { method: 'POST' });

// ---- Stats ----
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

export interface HostInfo {
  containers_running: number;
  containers_total: number;
  images: number;
  server_version: string;
  os: string;
  architecture: string;
  cpus: number;
  memory_total: string;
}

export interface StatsResponse {
  host: HostInfo;
  containers: ContainerStats[];
}

export const getStats = () => request<StatsResponse>('/stats');

// ---- Converter ----
export const convertDockerRun = (command: string) =>
  request<{ compose: string }>('/convert', { method: 'POST', body: JSON.stringify({ command }) });

// ---- Resources ----
export interface ResourceConfig {
  limits_cpus?: string;
  limits_memory?: string;
  reservations_cpus?: string;
  reservations_memory?: string;
  update_excluded?: boolean;
  update_check_excluded?: boolean;
}

export const getStackResources = (name: string) =>
  request<Record<string, ResourceConfig>>(`/resources/${name}`);
export const updateServiceResources = (stackName: string, serviceName: string, config: ResourceConfig) =>
  request<{ ok: boolean; content: string; needsRestart: boolean }>(`/resources/${stackName}/${serviceName}`, {
    method: 'PUT', body: JSON.stringify(config),
  });

export async function streamStackAction(
  name: string,
  action: 'up' | 'down' | 'restart' | 'update',
  onLog: (text: string) => void
): Promise<void> {
  const res = await fetch(`${BASE}/stacks/${name}/${action}?stream=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming not supported by browser');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.substring(6);
          if (dataStr.trim()) {
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.chunk) {
                // Compose output often uses carriage-return progress updates.
                // Convert to clean newlines so the web terminal stays readable.
                const normalized = String(parsed.chunk)
                  .replace(/\r\n/g, '\n')
                  .replace(/\r/g, '\n')
                  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
                onLog(normalized);
              }
              if (parsed.finish) return;
            } catch (err: any) {
              // Ignore partial JSON parse errors for safety if we split chunks wrong.
              if (err.name === 'SyntaxError') continue;
              throw err;
            }
          }
        }
      }
    }
    if (done) break;
  }
}

// ---- Meta ----
export interface AppVersionStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  githubUrl: string;
  releaseUrl: string | null;
  checkFailed: boolean;
}

export const getAppVersionStatus = (force = false) =>
  request<AppVersionStatus>(`/meta/version${force ? '?force=true' : ''}`);
