import { getStackImages, getLocalDigest } from './docker.js';
import { setUpdateCache, getAllUpdateCache, getUpdateCache, getSetting } from '../db.js';
import { notifyUpdatesAvailable } from './discord.js';
import { listStacks } from './docker.js';
import { getComposeContent } from './docker.js';
import { parse } from 'yaml';

interface RegistryToken {
  token: string;
}

const DEFAULT_ALLOWED_REGISTRIES = [
  'registry-1.docker.io',
  'ghcr.io',
  'quay.io',
  'lscr.io',
  'mcr.microsoft.com',
];

function getAllowedRegistries(): Set<string> {
  const raw = String(process.env.DOCKWATCH_ALLOWED_REGISTRIES || '').trim();
  if (!raw) {
    return new Set(DEFAULT_ALLOWED_REGISTRIES);
  }

  const values = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return new Set(values.length > 0 ? values : DEFAULT_ALLOWED_REGISTRIES);
}

export function isAllowedRegistryHost(registry: string): boolean {
  const normalized = registry.trim().toLowerCase();
  if (!normalized) return false;
  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(normalized)) return false;

  const hostOnly = normalized.split(':')[0];
  if (hostOnly === 'localhost') return false;

  return getAllowedRegistries().has(normalized) || getAllowedRegistries().has(hostOnly);
}

export function buildManifestUrl(registry: string, repo: string, tag: string): URL {
  const encodedRepo = repo
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const encodedTag = encodeURIComponent(tag);
  return new URL(`https://${registry}/v2/${encodedRepo}/manifests/${encodedTag}`);
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
async function getRemoteDigest(image: string): Promise<string | null> {
  const { registry, repo, tag } = parseImage(image);
  if (!isAllowedRegistryHost(registry)) {
    console.warn('[UpdateChecker] Skipping image from non-allowed registry host', { registry, image });
    return null;
  }

  try {
    let headers: Record<string, string> = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json',
    };

    // Docker Hub needs a token
    if (registry === 'registry-1.docker.io') {
      const tokenUrl = new URL('https://auth.docker.io/token');
      tokenUrl.searchParams.set('service', 'registry.docker.io');
      tokenUrl.searchParams.set('scope', `repository:${repo}:pull`);
      const tokenResp = await fetch(tokenUrl);
      if (!tokenResp.ok) return null;
      const tokenData = await tokenResp.json() as RegistryToken;
      headers['Authorization'] = `Bearer ${tokenData.token}`;
    }

    const manifestUrl = buildManifestUrl(registry, repo, tag);
    const resp = await fetch(manifestUrl, { method: 'HEAD', headers });

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
}

/** Check a single image for updates */
export async function checkImageUpdate(image: string): Promise<UpdateResult> {
  const localDigest = await getLocalDigest(image);
  const remoteDigest = await getRemoteDigest(image);

  const updateAvailable = !!(localDigest && remoteDigest && localDigest !== remoteDigest);
  setUpdateCache(image, localDigest, remoteDigest);

  return { image, localDigest, remoteDigest, updateAvailable };
}

/** Check all images across all stacks */
export async function checkAllUpdates(): Promise<UpdateResult[]> {
  const stacks = await listStacks();
  const allImages = new Set<string>();

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
          allImages.add(image);
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
          allImages.add(img);
        } else {
          console.log(`Skipping update check for excluded image: ${img}`);
        }
      });
    }
  }

  const results: UpdateResult[] = [];
  for (const image of allImages) {
    const result = await checkImageUpdate(image);
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
export function getCachedUpdates(): { image: string; local_digest: string | null; remote_digest: string | null; checked_at: string; updateAvailable: boolean }[] {
  const cached = getAllUpdateCache();
  return cached.map(c => ({
    ...c,
    updateAvailable: !!(c.local_digest && c.remote_digest && c.local_digest !== c.remote_digest),
  }));
}
