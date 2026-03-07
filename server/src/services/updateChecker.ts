import { getStackImages, getLocalDigest } from './docker.js';
import { setUpdateCache, getAllUpdateCache, getUpdateCache, getSetting } from '../db.js';
import { notifyUpdatesAvailable } from './discord.js';
import { listStacks } from './docker.js';
import { getComposeContent } from './docker.js';
import { parse } from 'yaml';

interface RegistryToken {
  token: string;
}

/** Parse image reference into registry, repo, tag */
function parseImage(image: string): { registry: string; repo: string; tag: string } {
  let registry = 'registry-1.docker.io';
  let repo = image;
  let tag = 'latest';

  // Handle tag
  const colonIdx = repo.lastIndexOf(':');
  if (colonIdx > 0 && !repo.substring(colonIdx).includes('/')) {
    tag = repo.substring(colonIdx + 1);
    repo = repo.substring(0, colonIdx);
  }

  // Handle registry
  if (repo.includes('.') && repo.indexOf('.') < repo.indexOf('/')) {
    const slashIdx = repo.indexOf('/');
    registry = repo.substring(0, slashIdx);
    repo = repo.substring(slashIdx + 1);
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

  try {
    let headers: Record<string, string> = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json',
    };

    // Docker Hub needs a token
    if (registry === 'registry-1.docker.io') {
      const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`;
      const tokenResp = await fetch(tokenUrl);
      if (!tokenResp.ok) return null;
      const tokenData = await tokenResp.json() as RegistryToken;
      headers['Authorization'] = `Bearer ${tokenData.token}`;
    }

    const manifestUrl = `https://${registry}/v2/${repo}/manifests/${tag}`;
    const resp = await fetch(manifestUrl, { method: 'HEAD', headers });

    if (!resp.ok) return null;

    const digest = resp.headers.get('docker-content-digest');
    return digest;
  } catch (err) {
    console.error(`Failed to check remote digest for ${image}:`, err);
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
