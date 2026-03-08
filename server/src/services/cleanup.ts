import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  getLatestCleanupRun,
  getCleanupSummary,
  getSetting,
  insertCleanupRun,
  setSetting,
} from '../db.js';
import { notifyCleanupRun } from './discord.js';

const execFileAsync = promisify(execFile);

export type CleanupFrequency = 'daily' | 'weekly' | 'monthly';

export interface CleanupConfig {
  scheduleEnabled: boolean;
  scheduleFrequency: CleanupFrequency;
  scheduleTime: string; // HH:mm
  protectionEnabled: boolean;
  protectedImageLabels: string[];
  protectedVolumeLabels: string[];
  options: {
    containers: boolean;
    images: boolean;
    networks: boolean;
    volumes: boolean;
    buildCache: boolean;
  };
}

export interface CleanupPreview {
  containers: { total: number; reclaimable: string };
  images: { total: number; reclaimable: string };
  volumes: { total: number; reclaimable: string };
  buildCache: { total: number; reclaimable: string };
}

export interface CleanupRunResult {
  reason: 'manual' | 'scheduled';
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  reclaimedBytes: number;
  reclaimedHuman: string;
  deleted: {
    containers: number;
    images: number;
    networks: number;
    volumes: number;
    buildCache: number;
  };
  outputs: string[];
  success: boolean;
  error?: string;
}

export interface CleanupRunOptions {
  dryRun?: boolean;
  onChunk?: (chunk: string) => void;
}

export interface CleanupDashboard {
  config: CleanupConfig;
  preview: CleanupPreview | null;
  stats: {
    totalReclaimedBytes: number;
    totalReclaimedHuman: string;
    pruneRuns: number;
    failedRuns: number;
    deleted: {
      containers: number;
      images: number;
      networks: number;
      volumes: number;
      buildCache: number;
    };
    firstRunAt: string | null;
    lastRunAt: string | null;
    latestRun: CleanupRunResult | null;
  };
}

function isTrue(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function parseFrequency(value: string | undefined): CleanupFrequency {
  if (value === 'weekly' || value === 'monthly') return value;
  return 'daily';
}

function normalizeTime(value: string | undefined): string {
  const candidate = (value || '00:00').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate)) return '00:00';
  return candidate;
}

export function getCleanupConfig(): CleanupConfig {
  return {
    scheduleEnabled: isTrue(getSetting('cleanup_schedule_enabled'), false),
    scheduleFrequency: parseFrequency(getSetting('cleanup_schedule_frequency')),
    scheduleTime: normalizeTime(getSetting('cleanup_schedule_time')),
    protectionEnabled: isTrue(getSetting('cleanup_protection_enabled'), true),
    protectedImageLabels: parseLabelList(getSetting('cleanup_protected_image_labels')),
    protectedVolumeLabels: parseLabelList(getSetting('cleanup_protected_volume_labels')),
    options: {
      containers: isTrue(getSetting('cleanup_option_containers'), false),
      images: isTrue(getSetting('cleanup_option_images'), false),
      networks: isTrue(getSetting('cleanup_option_networks'), false),
      volumes: isTrue(getSetting('cleanup_option_volumes'), false),
      buildCache: isTrue(getSetting('cleanup_option_build_cache'), false),
    },
  };
}

export function saveCleanupConfig(input: Partial<CleanupConfig>): CleanupConfig {
  const current = getCleanupConfig();

  const next: CleanupConfig = {
    scheduleEnabled: typeof input.scheduleEnabled === 'boolean' ? input.scheduleEnabled : current.scheduleEnabled,
    scheduleFrequency: input.scheduleFrequency || current.scheduleFrequency,
    scheduleTime: input.scheduleTime || current.scheduleTime,
    protectionEnabled: typeof input.protectionEnabled === 'boolean' ? input.protectionEnabled : current.protectionEnabled,
    protectedImageLabels: Array.isArray(input.protectedImageLabels) ? input.protectedImageLabels : current.protectedImageLabels,
    protectedVolumeLabels: Array.isArray(input.protectedVolumeLabels) ? input.protectedVolumeLabels : current.protectedVolumeLabels,
    options: {
      containers: typeof input.options?.containers === 'boolean' ? input.options.containers : current.options.containers,
      images: typeof input.options?.images === 'boolean' ? input.options.images : current.options.images,
      networks: typeof input.options?.networks === 'boolean' ? input.options.networks : current.options.networks,
      volumes: typeof input.options?.volumes === 'boolean' ? input.options.volumes : current.options.volumes,
      buildCache: typeof input.options?.buildCache === 'boolean' ? input.options.buildCache : current.options.buildCache,
    },
  };

  next.scheduleTime = normalizeTime(next.scheduleTime);
  next.scheduleFrequency = parseFrequency(next.scheduleFrequency);
  next.protectedImageLabels = sanitizeLabelList(next.protectedImageLabels);
  next.protectedVolumeLabels = sanitizeLabelList(next.protectedVolumeLabels);

  setSetting('cleanup_schedule_enabled', String(next.scheduleEnabled));
  setSetting('cleanup_schedule_frequency', next.scheduleFrequency);
  setSetting('cleanup_schedule_time', next.scheduleTime);
  setSetting('cleanup_protection_enabled', String(next.protectionEnabled));
  setSetting('cleanup_protected_image_labels', next.protectedImageLabels.join(','));
  setSetting('cleanup_protected_volume_labels', next.protectedVolumeLabels.join(','));
  setSetting('cleanup_option_containers', String(next.options.containers));
  setSetting('cleanup_option_images', String(next.options.images));
  setSetting('cleanup_option_networks', String(next.options.networks));
  setSetting('cleanup_option_volumes', String(next.options.volumes));
  setSetting('cleanup_option_build_cache', String(next.options.buildCache));

  return next;
}

function parseDockerDfRows(output: string): CleanupPreview {
  const preview: CleanupPreview = {
    containers: { total: 0, reclaimable: '0B' },
    images: { total: 0, reclaimable: '0B' },
    volumes: { total: 0, reclaimable: '0B' },
    buildCache: { total: 0, reclaimable: '0B' },
  };

  const lines = output.trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as {
        Type?: string;
        TotalCount?: string;
        Reclaimable?: string;
      };
      const type = String(row.Type || '').toLowerCase();
      const total = parseInt(String(row.TotalCount || '0'), 10) || 0;
      const reclaimable = String(row.Reclaimable || '0B').trim();

      if (type.includes('container')) {
        preview.containers = { total, reclaimable };
      } else if (type.includes('image')) {
        preview.images = { total, reclaimable };
      } else if (type.includes('volume')) {
        preview.volumes = { total, reclaimable };
      } else if (type.includes('build cache')) {
        preview.buildCache = { total, reclaimable };
      }
    } catch {
      // Ignore malformed lines; keep best-effort preview.
    }
  }

  return preview;
}

export async function getCleanupPreview(): Promise<CleanupPreview> {
  const result = await execFileAsync('docker', ['system', 'df', '--format', '{{json .}}'], { timeout: 20_000 });
  return parseDockerDfRows(result.stdout);
}

function parseSizeToBytes(sizeText: string): number {
  const text = sizeText.trim().replace(/\s+/g, ' ').replace(/\([^)]*\)/g, '').trim();
  if (!text || text === '0' || text.toLowerCase() === '0b') return 0;

  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?i?b?)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const powers: Record<string, number> = {
    B: 0,
    KB: 1,
    MB: 2,
    GB: 3,
    TB: 4,
    PB: 5,
    KIB: 1,
    MIB: 2,
    GIB: 3,
    TIB: 4,
    PIB: 5,
  };

  const power = powers[unit] ?? 0;
  const base = unit.endsWith('IB') ? 1024 : 1000;
  return Math.round(value * base ** power);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

function countDeleted(output: string, header: string): number {
  const re = new RegExp(`${header}:\\n([\\s\\S]*?)\\n(?:Total reclaimed space:|$)`, 'i');
  const match = output.match(re);
  if (!match) return 0;
  return match[1]
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .length;
}

function parseReclaimedBytes(output: string): number {
  const match = output.match(/Total reclaimed space:\s*([^\n]+)/i);
  if (!match) return 0;
  return parseSizeToBytes(match[1].trim());
}

function parseLabelList(value: string | undefined): string[] {
  if (!value) return [];
  return sanitizeLabelList(value.split(','));
}

function sanitizeLabelList(input: string[]): string[] {
  const uniq = new Set<string>();
  for (const raw of input) {
    const label = String(raw || '').trim();
    if (!label) continue;
    uniq.add(label);
  }
  return [...uniq];
}

async function runPruneCommand(args: string[]): Promise<string> {
  const result = await execFileAsync('docker', args, { timeout: 120_000 });
  return result.stdout;
}

let cleanupRunning = false;

export function isCleanupRunning(): boolean {
  return cleanupRunning;
}

export async function runCleanup(
  reason: 'manual' | 'scheduled',
  config = getCleanupConfig(),
  options: CleanupRunOptions = {},
): Promise<CleanupRunResult> {
  if (cleanupRunning) {
    throw new Error('Cleanup already running');
  }

  const dryRun = Boolean(options.dryRun);
  const emit = (chunk: string) => {
    if (options.onChunk) options.onChunk(chunk);
  };

  const started = new Date();
  cleanupRunning = true;
  const outputs: string[] = [];

  const deleted = {
    containers: 0,
    images: 0,
    networks: 0,
    volumes: 0,
    buildCache: 0,
  };

  let reclaimedBytes = 0;
  let success = true;
  let error: string | undefined;

  try {
    emit(`== DockWatch Cleanup (${dryRun ? 'dry-run' : 'live'}) ==\n`);
    emit(`Reason: ${reason}\n`);
    emit(`Started: ${started.toISOString()}\n\n`);

    if (dryRun) {
      const preview = await getCleanupPreview();
      const estimated = {
        containers: config.options.containers ? parseSizeToBytes(preview.containers.reclaimable) : 0,
        images: config.options.images ? parseSizeToBytes(preview.images.reclaimable) : 0,
        networks: config.options.networks ? 0 : 0,
        volumes: config.options.volumes ? parseSizeToBytes(preview.volumes.reclaimable) : 0,
        buildCache: config.options.buildCache ? parseSizeToBytes(preview.buildCache.reclaimable) : 0,
      };

      reclaimedBytes = estimated.containers + estimated.images + estimated.networks + estimated.volumes + estimated.buildCache;

      const drySummary = [
        'No changes executed. Preview only.',
        `protection-enabled: ${config.protectionEnabled}`,
        `protected-image-labels: ${config.protectedImageLabels.join(', ') || '(none)'}`,
        `protected-volume-labels: ${config.protectedVolumeLabels.join(', ') || '(none)'}`,
        `containers: enabled=${config.options.containers} reclaimable=${preview.containers.reclaimable}`,
        `images: enabled=${config.options.images} reclaimable=${preview.images.reclaimable}`,
        `networks: enabled=${config.options.networks} reclaimable=unknown`,
        `volumes: enabled=${config.options.volumes} reclaimable=${preview.volumes.reclaimable}`,
        `build-cache: enabled=${config.options.buildCache} reclaimable=${preview.buildCache.reclaimable}`,
        `estimated-total: ${formatBytes(reclaimedBytes)}`,
      ].join('\n');

      outputs.push(drySummary);
      emit(`${drySummary}\n`);
      emit('\nSafety note: Docker prune never deletes resources used by running containers.\n');
    } else {
      emit('Safety note: Docker prune never deletes resources used by running containers.\n\n');

      const execStep = async (label: string, args: string[], deletedHeader: string, deletedKey: keyof typeof deleted) => {
        emit(`-- ${label} --\n$ docker ${args.join(' ')}\n`);
        const out = await runPruneCommand(args);
        outputs.push(`[${label}]\n${out}`);
        emit(`${out.trimEnd()}\n\n`);
        deleted[deletedKey] += countDeleted(out, deletedHeader);
        reclaimedBytes += parseReclaimedBytes(out);
      };

      if (config.options.containers) {
        await execStep('container prune', ['container', 'prune', '-f'], 'Deleted Containers', 'containers');
      }

      if (config.options.images) {
        const imageArgs = ['image', 'prune', '-a', '-f'];
        if (config.protectionEnabled) {
          for (const label of config.protectedImageLabels) {
            imageArgs.push('--filter', `label!=${label}`);
          }
        }
        await execStep('image prune -a', imageArgs, 'Deleted Images', 'images');
      }

      if (config.options.networks) {
        await execStep('network prune', ['network', 'prune', '-f'], 'Deleted Networks', 'networks');
      }

      if (config.options.volumes) {
        const volumeArgs = ['volume', 'prune', '-f'];
        if (config.protectionEnabled) {
          for (const label of config.protectedVolumeLabels) {
            volumeArgs.push('--filter', `label!=${label}`);
          }
        }
        await execStep('volume prune', volumeArgs, 'Deleted Volumes', 'volumes');
      }

      if (config.options.buildCache) {
        await execStep('builder prune', ['builder', 'prune', '-f'], 'Deleted build cache objects', 'buildCache');
      }
    }
  } catch (err: any) {
    success = false;
    error = err?.message || 'Cleanup failed';
    outputs.push(`[error]\n${error}`);
    emit(`[error]\n${error}\n`);
  } finally {
    const finished = new Date();
    cleanupRunning = false;

    const result: CleanupRunResult = {
      reason,
      dryRun,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      reclaimedBytes,
      reclaimedHuman: formatBytes(reclaimedBytes),
      deleted,
      outputs,
      success,
      error,
    };

    emit(`== Summary ==\n`);
    emit(`dry-run: ${dryRun}\n`);
    emit(`reclaimed: ${result.reclaimedHuman}\n`);
    emit(`deleted: containers=${deleted.containers} images=${deleted.images} networks=${deleted.networks} volumes=${deleted.volumes} build-cache=${deleted.buildCache}\n`);
    emit(`status: ${success ? 'success' : 'failed'}\n`);

    if (!dryRun) {
      insertCleanupRun({
        reason,
        started_at: result.startedAt,
        finished_at: result.finishedAt,
        reclaimed_bytes: reclaimedBytes,
        deleted_containers: deleted.containers,
        deleted_images: deleted.images,
        deleted_networks: deleted.networks,
        deleted_volumes: deleted.volumes,
        deleted_build_cache: deleted.buildCache,
        success,
        error,
      });

      await notifyCleanupRun(result);
    }

    if (!success) {
      throw new Error(error || 'Cleanup failed');
    }

    return result;
  }
}

export function getCleanupDashboardSync(preview: CleanupPreview | null): CleanupDashboard {
  const summary = getCleanupSummary();
  const latest = getLatestCleanupRun();

  return {
    config: getCleanupConfig(),
    preview,
    stats: {
      totalReclaimedBytes: summary.total_reclaimed_bytes,
      totalReclaimedHuman: formatBytes(summary.total_reclaimed_bytes),
      pruneRuns: summary.prune_runs,
      failedRuns: summary.failed_runs,
      deleted: {
        containers: summary.deleted_containers,
        images: summary.deleted_images,
        networks: summary.deleted_networks,
        volumes: summary.deleted_volumes,
        buildCache: summary.deleted_build_cache,
      },
      firstRunAt: summary.first_run_at,
      lastRunAt: summary.last_run_at,
      latestRun: latest
        ? {
            reason: latest.reason === 'scheduled' ? 'scheduled' : 'manual',
            dryRun: false,
            startedAt: latest.started_at,
            finishedAt: latest.finished_at,
            reclaimedBytes: latest.reclaimed_bytes,
            reclaimedHuman: formatBytes(latest.reclaimed_bytes),
            deleted: {
              containers: latest.deleted_containers,
              images: latest.deleted_images,
              networks: latest.deleted_networks,
              volumes: latest.deleted_volumes,
              buildCache: latest.deleted_build_cache,
            },
            outputs: [],
            success: latest.success === 1,
            error: latest.error || undefined,
          }
        : null,
    },
  };
}
