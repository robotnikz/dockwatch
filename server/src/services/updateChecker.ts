import { getStackImages, getLocalDigest } from './docker.js';
import { setUpdateCache, getAllUpdateCache, getUpdateCache, getSetting } from '../db.js';
import { notifyUpdatesAvailable } from './discord.js';
import { listStacks } from './docker.js';
import { getComposeContent } from './docker.js';
import { parse } from 'yaml';

interface RegistryToken {
  token: string;
}

const REGISTRY_REQUEST_TIMEOUT_MS = 7_000;
const REGISTRY_REQUEST_ATTEMPTS = 3;

const DEFAULT_ALLOWED_REGISTRIES = [
  'registry-1.docker.io',
  'ghcr.io',
  'quay.io',
  'lscr.io',
  'mcr.microsoft.com',
];

let allowedRegistriesCacheRaw = '';
let allowedRegistriesCache = new Set<string>(DEFAULT_ALLOWED_REGISTRIES);

function getAllowedRegistries(): Set<string> {
  const raw = String(process.env.DOCKWATCH_ALLOWED_REGISTRIES || '').trim();
  if (raw === allowedRegistriesCacheRaw) {
    return allowedRegistriesCache;
  }

  allowedRegistriesCacheRaw = raw;
  if (!raw) {
    allowedRegistriesCache = new Set(DEFAULT_ALLOWED_REGISTRIES);
    return allowedRegistriesCache;
  }

  const values = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  allowedRegistriesCache = new Set(values.length > 0 ? values : DEFAULT_ALLOWED_REGISTRIES);
  return allowedRegistriesCache;
}

export function isAllowedRegistryHost(registry: string): boolean {
  const normalized = registry.trim().toLowerCase();
  if (!normalized) return false;
  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(normalized)) return false;

  const hostOnly = normalized.split(':')[0];
  if (hostOnly === 'localhost') return false;

  return getAllowedRegistries().has(normalized) || getAllowedRegistries().has(hostOnly);
}

function resolveAllowedRegistryHost(registry: string): string | null {
  const normalized = registry.trim().toLowerCase();
  if (!normalized) return null;

  if (getAllowedRegistries().has(normalized)) {
    return normalized;
  }

  const hostOnly = normalized.split(':')[0];
  if (getAllowedRegistries().has(hostOnly)) {
    return hostOnly;
  }

  return null;
}

export function buildManifestUrl(registry: string, repo: string, tag: string): URL {
  const encodedRepo = repo
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const encodedTag = encodeURIComponent(tag);
  return new URL(`https://${registry}/v2/${encodedRepo}/manifests/${encodedTag}`);
}

function isSafeManifestUrl(url: URL, expectedHost: string): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host !== expectedHost.toLowerCase()) return false;
  return /^\/v2\/[a-z0-9%._\/-]+\/manifests\/[a-z0-9%._-]+$/i.test(url.pathname);
}

/** Parse image reference into registry, repo, tag */
export function parseImage(image: string): { registry: string; repo: string; tag: string } {
  let registry = 'registry-1.docker.io';
  let ref = image.trim();
  let tag = 'latest';

  // Skip digest-pinned references. They are immutable and cannot have "newer" tags.
  const digestIdx = ref.indexOf('@');
  if (digestIdx >= 0) {
    ref = ref.substring(0, digestIdx);
  }

  // Tag separator is the last ':' that appears after the last '/'.
  const lastSlash = ref.lastIndexOf('/');
  const lastColon = ref.lastIndexOf(':');
  if (lastColon > lastSlash) {
    tag = ref.substring(lastColon + 1);
    ref = ref.substring(0, lastColon);
  }

  let repo = ref;
  const firstSlash = ref.indexOf('/');
  if (firstSlash > 0) {
    const firstPart = ref.substring(0, firstSlash);
    // Docker treats this as explicit registry if it contains '.' or ':' or is localhost.
    if (firstPart.includes('.') || firstPart.includes(':') || firstPart === 'localhost') {
      registry = firstPart;
      if (registry === 'docker.io') {
        registry = 'registry-1.docker.io';
      }
      repo = ref.substring(firstSlash + 1);
    }
  }

  // Docker Hub short names
  if (registry === 'registry-1.docker.io' && !repo.includes('/')) {
    repo = `library/${repo}`;
  }

  return { registry, repo, tag };
}

/** Get remote manifest digest from registry */
async function fetchWithRetry(
  url: URL,
  init: RequestInit,
  label: string,
  maxAttempts = REGISTRY_REQUEST_ATTEMPTS,
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const startedAt = Date.now();
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REGISTRY_REQUEST_TIMEOUT_MS),
      });
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > 3_000) {
        console.warn(`[UpdateChecker] Slow ${label} response`, {
          url: url.toString(),
          elapsedMs,
          attempt,
        });
      }

      if (response.ok || response.status < 500 || attempt === maxAttempts) {
        return response;
      }
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) {
        throw err;
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`Failed ${label} request`);
}

async function getRemoteDigest(image: string, context?: string): Promise<string | null> {
  const { registry, repo, tag } = parseImage(image);
  const resolvedRegistry = resolveAllowedRegistryHost(registry);
  if (!resolvedRegistry) {
    console.warn(`[UpdateChecker] Skipping image from non-allowed registry host${context ? ` (${context})` : ''}`, { registry, image });
    return null;
  }

  try {
    let headers: Record<string, string> = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json',
    };

    // Docker Hub needs a token
    if (resolvedRegistry === 'registry-1.docker.io') {
      const tokenUrl = new URL('https://auth.docker.io/token');
      tokenUrl.searchParams.set('service', 'registry.docker.io');
      tokenUrl.searchParams.set('scope', `repository:${repo}:pull`);
      const tokenResp = await fetchWithRetry(tokenUrl, { method: 'GET' }, 'registry token');
      if (!tokenResp.ok) return null;
      const tokenData = await tokenResp.json() as RegistryToken;
      headers['Authorization'] = `Bearer ${tokenData.token}`;
    }

    const manifestUrl = buildManifestUrl(resolvedRegistry, repo, tag);
    if (!isSafeManifestUrl(manifestUrl, resolvedRegistry)) {
      console.warn('[UpdateChecker] Rejected unsafe manifest URL', { image, manifestUrl: manifestUrl.toString() });
      return null;
    }
    const resp = await fetchWithRetry(manifestUrl, { method: 'HEAD', headers }, 'registry manifest');

    if (!resp.ok) return null;

    const digest = resp.headers.get('docker-content-digest');
    return digest;
  } catch (err) {
    console.error('[UpdateChecker] Failed to check remote digest', {
      image,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface UpdateResult {
  image: string;
  localDigest: string | null;
  remoteDigest: string | null;
  updateAvailable: boolean;
  context?: string;
}

function isDigestPinnedImage(image: string): boolean {
  return /@sha256:[a-f0-9]{64}$/i.test(image.trim());
}

/** Check a single image for updates */
export async function checkImageUpdate(image: string, context?: string): Promise<UpdateResult> {
  // Digest-pinned images are immutable by design and should not report tag-based updates.
  if (isDigestPinnedImage(image)) {
    const localDigest = await getLocalDigest(image);
    setUpdateCache(image, localDigest, localDigest, context);
    return { image, localDigest, remoteDigest: localDigest, updateAvailable: false, context };
  }

  const localDigest = await getLocalDigest(image);
  const remoteDigest = await getRemoteDigest(image, context);

  const updateAvailable = !!(localDigest && remoteDigest && localDigest !== remoteDigest);
  setUpdateCache(image, localDigest, remoteDigest, context);

  return { image, localDigest, remoteDigest, updateAvailable, context };
}

/** Check all images across all stacks */
export async function checkAllUpdates(): Promise<UpdateResult[]> {
  const stacks = await listStacks();
  const imagesToProcess: { image: string; contexts: string[] }[] = [];

  const exclusionsStr = (getSetting('update_exclusions') || '').toLowerCase();
  const exclusions = exclusionsStr.split(',').map(s => s.trim()).filter(Boolean);

  for (const stack of stacks) {
    try {
      const compose = await getComposeContent(stack);
      const doc = parse(compose) as any;
      const services = doc?.services || {};
      for (const [serviceName, serviceConfig] of Object.entries(services)) {
        const service = serviceConfig as any;
        const image = service?.image;
        if (!image || typeof image !== 'string') continue;

        const labels = service?.labels;
        const checkExcluded = Array.isArray(labels)
          ? labels.some((l: unknown) => typeof l === 'string' && l.startsWith('dockwatch.update.check.exclude=') && l.split('=')[1]?.trim() === 'true')
          : (labels && typeof labels === 'object'
            ? String((labels as Record<string, unknown>)['dockwatch.update.check.exclude']).trim().toLowerCase() === 'true'
            : false);

        if (checkExcluded) {
          console.log(`Skipping update check for excluded service: ${stack}/${String(serviceName)}`);
          continue;
        }

        const isExcluded = exclusions.some(ex => image.toLowerCase().includes(ex));
        if (!isExcluded) {
          const context = `${stack}/${String(serviceName)}`;
          const existing = imagesToProcess.find(item => item.image === image);
          if (existing) {
            if (!existing.contexts.includes(context)) {
              existing.contexts.push(context);
            }
          } else {
            imagesToProcess.push({ image, contexts: [context] });
          }
        } else {
          console.log(`Skipping update check for excluded image: ${image}`);
        }
      }
    } catch {
      // Fallback to legacy image discovery if compose parsing fails.
      const images = await getStackImages(stack);
      images.forEach(img => {
        const isExcluded = exclusions.some(ex => img.toLowerCase().includes(ex));
        if (!isExcluded) {
          const context = `stack:${stack}`;
          const existing = imagesToProcess.find(item => item.image === img);
          if (existing) {
            if (!existing.contexts.includes(context)) {
              existing.contexts.push(context);
            }
          } else {
            imagesToProcess.push({ image: img, contexts: [context] });
          }
        } else {
          console.log(`Skipping update check for excluded image: ${img}`);
        }
      });
    }
  }

  const results: UpdateResult[] = [];
  for (const { image, contexts } of imagesToProcess) {
    const result = await checkImageUpdate(image, contexts.join(', '));
    results.push(result);
  }

  // Send Discord notification for any updates
  const updatesAvailable = results.filter(r => r.updateAvailable);
  if (updatesAvailable.length > 0) {
    await notifyUpdatesAvailable(updatesAvailable);
  }

  return results;
}

/** Get cached update status */
export function getCachedUpdates(): (UpdateResult & { checked_at: string })[] {
  const cached = getAllUpdateCache();
  return cached.map(c => ({
    image: c.image,
    localDigest: c.local_digest,
    remoteDigest: c.remote_digest,
    context: c.context || undefined,
    checked_at: c.checked_at,
    updateAvailable: !!(c.local_digest && c.remote_digest && c.local_digest !== c.remote_digest),
  }));
}
