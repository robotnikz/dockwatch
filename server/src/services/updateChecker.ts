import { getStackImages, getImageRepoDigests, getComposeProcessEnv, getStackEnv, hasTrueLabel } from './docker.js';
import { setUpdateCache, getAllUpdateCache, getUpdateCache, getSetting, markUpdateNotified, pruneUpdateCache } from '../db.js';
import { notifyUpdatesAvailable } from './discord.js';
import { listStacks, getComposeContent } from './docker.js';
import { parse } from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface RegistryToken {
  token?: string;
  access_token?: string;
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const DOCKER_HUB_CONFIG_KEYS = ['https://index.docker.io/v1/', 'index.docker.io', 'docker.io', 'registry-1.docker.io'];

function dockerConfigPath(): string {
  const dir = process.env.DOCKER_CONFIG || path.join(process.env.HOME || os.homedir(), '.docker');
  return path.join(dir, 'config.json');
}

/**
 * Base64 `user:password` for a registry from the Docker client config
 * (`~/.docker/config.json`, mount it read-only to check private images).
 * Only inline `auths` entries are supported, not credential helpers.
 */
export function getRegistryBasicAuth(registry: string, configPath = dockerConfigPath()): string | null {
  let auths: Record<string, { auth?: string; username?: string; password?: string }>;
  try {
    auths = JSON.parse(fs.readFileSync(configPath, 'utf-8'))?.auths ?? {};
  } catch {
    return null;
  }

  const host = registry.trim().toLowerCase();
  const wanted = host === 'registry-1.docker.io' ? DOCKER_HUB_CONFIG_KEYS : [host];
  for (const [key, entry] of Object.entries(auths)) {
    let keyHost = key.trim().toLowerCase();
    try {
      if (keyHost.includes('://')) keyHost = new URL(keyHost).host;
    } catch { /* keep raw key */ }
    if (!wanted.includes(keyHost) && !wanted.includes(key.trim().toLowerCase())) continue;
    if (entry?.auth) return entry.auth;
    if (entry?.username && entry?.password) {
      return Buffer.from(`${entry.username}:${entry.password}`).toString('base64');
    }
  }
  return null;
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

/**
 * Validate a Docker image reference before it is handed to the Docker CLI or a
 * registry request. A valid reference always starts with an alphanumeric
 * character, never '-', which prevents the value from being interpreted as a
 * CLI flag (argument-injection hardening for `docker image inspect`).
 */
export function isValidImageReference(image: string): boolean {
  const ref = String(image || '').trim();
  if (ref.length === 0 || ref.length > 512) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/.test(ref);
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
      // Multi-arch images are published as manifest lists / OCI indexes. Without accepting
      // them, a registry may answer with a platform manifest whose digest never matches the
      // local RepoDigest, which would report a phantom update forever.
      'Accept': MANIFEST_ACCEPT,
    };
    const basicAuth = getRegistryBasicAuth(resolvedRegistry);

    // Docker Hub needs a token
    if (resolvedRegistry === 'registry-1.docker.io') {
      const tokenUrl = new URL('https://auth.docker.io/token');
      tokenUrl.searchParams.set('service', 'registry.docker.io');
      tokenUrl.searchParams.set('scope', `repository:${repo}:pull`);
      const tokenHeaders: Record<string, string> = basicAuth ? { Authorization: `Basic ${basicAuth}` } : {};
      const tokenResp = await fetchWithRetry(tokenUrl, { method: 'GET', headers: tokenHeaders }, 'registry token');
      if (!tokenResp.ok) return null;
      const tokenData = await tokenResp.json() as RegistryToken;
      headers['Authorization'] = `Bearer ${tokenData.token ?? tokenData.access_token}`;
    }

    const manifestUrl = buildManifestUrl(resolvedRegistry, repo, tag);
    if (!isSafeManifestUrl(manifestUrl, resolvedRegistry)) {
      console.warn('[UpdateChecker] Rejected unsafe manifest URL', { image, manifestUrl: manifestUrl.toString() });
      return null;
    }
    let resp = await fetchWithRetry(manifestUrl, { method: 'HEAD', headers }, 'registry manifest');

    // Handle authentication for other registries (e.g. ghcr.io, lscr.io, quay.io) if they return 401
    if (resp.status === 401) {
      const authHeader = resp.headers.get('www-authenticate');
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        const realmMatch = authHeader.match(/realm="([^"]+)"/i);
        const serviceMatch = authHeader.match(/service="([^"]+)"/i);
        const scopeMatch = authHeader.match(/scope="([^"]+)"/i);
        
        if (realmMatch) {
          const authUrl = new URL(realmMatch[1]);
          if (serviceMatch) authUrl.searchParams.set('service', serviceMatch[1]);
          // fallback to repository:repo:pull if backend doesn't give a scope but 401'd
          if (scopeMatch) {
            authUrl.searchParams.set('scope', scopeMatch[1]);
          } else {
            authUrl.searchParams.set('scope', `repository:${repo}:pull`);
          }

          // Only hand credentials to a token endpoint on the registry's own host.
          const tokenHeaders: Record<string, string> = {};
          if (basicAuth && authUrl.protocol === 'https:' && authUrl.hostname.toLowerCase() === resolvedRegistry.split(':')[0]) {
            tokenHeaders.Authorization = `Basic ${basicAuth}`;
          }
          
          const tokenResp = await fetchWithRetry(authUrl, { method: 'GET', headers: tokenHeaders }, 'registry token fallback');
          if (tokenResp.ok) {
            const tokenData = await tokenResp.json() as RegistryToken;
            headers['Authorization'] = `Bearer ${tokenData.token ?? tokenData.access_token}`;
            resp = await fetchWithRetry(manifestUrl, { method: 'HEAD', headers }, 'registry manifest retry');
          }
        }
      } else if (authHeader && authHeader.toLowerCase().startsWith('basic ') && basicAuth) {
        headers['Authorization'] = `Basic ${basicAuth}`;
        resp = await fetchWithRetry(manifestUrl, { method: 'HEAD', headers }, 'registry manifest retry');
      }
    }

    if (!resp.ok) {
      console.warn(`[UpdateChecker] Failed to fetch manifest for ${image}: ${resp.status} ${resp.statusText}`);
      return null;
    }

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
  /** True when the image could not be compared (not pulled locally, registry unreachable or not allowed). */
  checkFailed: boolean;
  context?: string;
}

/**
 * Resolve compose-style variables (`$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`,
 * `${VAR:?err}`, `${VAR:+alt}`, `$$`) against the given environment.
 */
export function resolveEnvVars(str: string, env: Record<string, string | undefined>): string {
  if (typeof str !== 'string') return str;
  return str.replace(
    /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced: string | undefined, op: string | undefined, arg: string | undefined, bare: string | undefined) => {
      if (match === '$$') return '$';
      const key = (braced ?? bare) as string;
      const value = env[key];
      const isSet = value !== undefined;
      const isNonEmpty = isSet && value !== '';
      switch (op) {
        case ':-': return isNonEmpty ? value as string : (arg ?? '');
        case '-': return isSet ? value as string : (arg ?? '');
        case ':+': return isNonEmpty ? (arg ?? '') : '';
        case '+': return isSet ? (arg ?? '') : '';
        default: return value ?? '';
      }
    },
  );
}

/** Environment compose uses for interpolation: the stack's .env, overridden by the process env. */
export async function getStackInterpolationEnv(stack: string): Promise<Record<string, string>> {
  return { ...(await getStackEnv(stack)), ...getComposeProcessEnv() };
}

function isDigestPinnedImage(image: string): boolean {
  return /@sha256:[a-f0-9]{64}$/i.test(image.trim());
}

/** Digests of the local image that belong to the same repository as the image reference. */
export function matchRepoDigests(image: string, repoDigests: string[]): string[] {
  const wanted = parseImage(image);
  return repoDigests
    .map((entry) => {
      const at = entry.indexOf('@');
      if (at < 0) return null;
      const ref = parseImage(entry.slice(0, at));
      return ref.registry === wanted.registry && ref.repo === wanted.repo ? entry.slice(at + 1) : null;
    })
    .filter((digest): digest is string => !!digest && digest.startsWith('sha256:'));
}

/** Check a single image for updates */
export async function checkImageUpdate(image: string, context?: string): Promise<UpdateResult> {
  if (!isValidImageReference(image)) {
    throw new Error(`Invalid image reference: ${image}`);
  }
  const contextStr = context ? ` [${context}]` : '';
  console.log(`[UpdateChecker] Checking image: ${image}${contextStr}`);

  const repoDigests = await getImageRepoDigests(image);
  const localDigests = repoDigests ? matchRepoDigests(image, repoDigests) : [];
  const localDigest = localDigests[0] ?? null;

  // Digest-pinned images are immutable by design and should not report tag-based updates.
  if (isDigestPinnedImage(image)) {
    console.log(`[UpdateChecker] Image ${image} is digest-pinned. Skipping update check.`);
    setUpdateCache(image, localDigest, localDigest, context, false);
    return { image, localDigest, remoteDigest: localDigest, updateAvailable: false, checkFailed: false, context };
  }

  const remoteDigest = await getRemoteDigest(image, context);

  const checkFailed = !localDigest || !remoteDigest;
  const updateAvailable = !checkFailed && !localDigests.includes(remoteDigest as string);
  console.log(`[UpdateChecker] Result for ${image} - Local: ${localDigest?.slice(0, 15) || 'n/a'} | Remote: ${remoteDigest?.slice(0, 15) || 'n/a'} | Update: ${checkFailed ? 'UNKNOWN' : (updateAvailable ? 'YES' : 'NO')}`);
  
  setUpdateCache(image, localDigest, remoteDigest, context, checkFailed ? null : updateAvailable);

  return { image, localDigest, remoteDigest, updateAvailable, checkFailed, context };
}

function addImage(imagesToProcess: { image: string; contexts: string[] }[], image: string, context: string): void {
  const existing = imagesToProcess.find(item => item.image === image);
  if (existing) {
    if (!existing.contexts.includes(context)) {
      existing.contexts.push(context);
    }
  } else {
    imagesToProcess.push({ image, contexts: [context] });
  }
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
      const stackEnv = await getStackInterpolationEnv(stack);

      const doc = parse(compose) as any;
      const services = doc?.services || {};
      for (const [serviceName, serviceConfig] of Object.entries(services)) {
        const service = serviceConfig as any;
        let image = service?.image;
        if (!image || typeof image !== 'string') continue;
        
        image = resolveEnvVars(image, stackEnv).trim();
        if (!image) continue;

        if (hasTrueLabel(service?.labels, 'dockwatch.update.check.exclude')) {
          console.log(`Skipping update check for excluded service: ${stack}/${String(serviceName)}`);
          continue;
        }

        const isExcluded = exclusions.some(ex => image.toLowerCase().includes(ex));
        if (!isExcluded) {
          addImage(imagesToProcess, image, `${stack}/${String(serviceName)}`);
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
          addImage(imagesToProcess, img, `stack:${stack}`);
        } else {
          console.log(`Skipping update check for excluded image: ${img}`);
        }
      });
    }
  }

  const results: UpdateResult[] = [];
  if (imagesToProcess.length > 0) {
    console.log(`[UpdateChecker] Starting global update check for ${imagesToProcess.length} unique images...`);
  }

  for (const { image, contexts } of imagesToProcess) {
    try {
      const result = await checkImageUpdate(image, contexts.join(', '));
      results.push(result);
    } catch (err) {
      console.warn(`[UpdateChecker] Skipping ${image}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Drop cache rows of images that are no longer part of any stack or now excluded.
  const pruned = pruneUpdateCache(imagesToProcess.map(item => item.image));
  if (pruned > 0) {
    console.log(`[UpdateChecker] Removed ${pruned} stale update cache entries.`);
  }

  // Send Discord notification only for updates that were not announced before
  const updatesAvailable = results.filter(r => r.updateAvailable);
  const newUpdates = updatesAvailable.filter(r => getUpdateCache(r.image)?.notified_digest !== r.remoteDigest);
  if (updatesAvailable.length > 0) {
    console.log(`[UpdateChecker] Global check finished. Updates found for ${updatesAvailable.length} images (${newUpdates.length} new).`);
    if (newUpdates.length > 0) {
      await notifyUpdatesAvailable(newUpdates);
      newUpdates.forEach(r => markUpdateNotified(r.image, r.remoteDigest as string));
    }
  } else if (imagesToProcess.length > 0) {
    console.log(`[UpdateChecker] Global check finished. No new updates found.`);
  }

  return results;
}

/** Get cached update status */
export function getCachedUpdates(): (UpdateResult & { checked_at: string })[] {
  const cached = getAllUpdateCache();
  return cached.map(c => {
    // Rows written before update_available existed fall back to the digest comparison.
    const legacyAvailable = !!(c.local_digest && c.remote_digest && c.local_digest !== c.remote_digest);
    const checkFailed = c.update_available === null ? !(c.local_digest && c.remote_digest) : false;
    return {
      image: c.image,
      localDigest: c.local_digest,
      remoteDigest: c.remote_digest,
      context: c.context || undefined,
      checked_at: c.checked_at,
      updateAvailable: c.update_available === null ? legacyAvailable : c.update_available === 1,
      checkFailed,
    };
  });
}
