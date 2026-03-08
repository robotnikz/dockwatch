import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPackagePath = path.resolve(__dirname, '../../package.json');
const repoRootPath = path.resolve(__dirname, '../../..');

const GITHUB_OWNER = process.env.DOCKWATCH_GITHUB_OWNER || 'robotnikz';
const GITHUB_REPO = process.env.DOCKWATCH_GITHUB_REPO || 'dockwatch';
const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const TAGS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags?per_page=30`;
const COMPARE_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/compare`;
const CHECK_TTL_MS = 60 * 60 * 1000; // 1 hour
const TAG_PAGES_TO_SCAN = 10;

function getCurrentVersion(): string {
  const envVersion = normalizeVersion(process.env.DOCKWATCH_VERSION || '');
  if (envVersion) {
    return envVersion;
  }

  try {
    const described = execSync('git describe --tags --always', {
      cwd: repoRootPath,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    const coreMatch = normalizeVersion(described).match(/^\d+\.\d+\.\d+/);
    const normalized = coreMatch?.[0] || extractSemverPrefix(described) || normalizeVersion(described);
    if (normalized) {
      return normalized;
    }
  } catch {
    // Ignore and continue with package fallback.
  }

  try {
    const raw = readFileSync(serverPackagePath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return normalizeVersion(pkg.version || '') || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '').replace(/\+.*$/, '');
}

function extractSemverPrefix(value: string): string | null {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
}

// Lightweight semver comparison for stable x.y.z(-prerelease) strings.
function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = normalizeVersion(a).split('-', 2);
  const [bCore, bPre] = normalizeVersion(b).split('-', 2);

  const aParts = aCore.split('.').map((p) => parseInt(p, 10) || 0);
  const bParts = bCore.split('.').map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(aParts.length, bParts.length, 3);

  for (let i = 0; i < maxLen; i += 1) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  if (!aPre && bPre) return 1;
  if (aPre && !bPre) return -1;
  if (!aPre && !bPre) return 0;

  return String(aPre).localeCompare(String(bPre));
}

export interface AppVersionStatus {
  currentVersion: string;
  currentRevision: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  githubUrl: string;
  releaseUrl: string | null;
  checkFailed: boolean;
}

let cache: AppVersionStatus | null = null;
let lastCheckMs = 0;

function getGithubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dockwatch',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchLatestReleaseVersion(): Promise<{ latestVersion: string; releaseUrl: string | null }> {
  const headers = getGithubHeaders();

  const response = await fetch(RELEASE_API_URL, {
    headers,
  });

  if (response.ok) {
    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    const latest = extractSemverPrefix(data.tag_name || '');
    if (!latest) {
      throw new Error('GitHub release response did not include a semver tag_name');
    }

    return { latestVersion: latest, releaseUrl: data.html_url || null };
  }

  // Fallback for repos without a proper latest release object: derive from tags.
  const tagsResponse = await fetch(TAGS_API_URL, {
    headers: {
      ...headers,
    },
  });

  if (!tagsResponse.ok) {
    throw new Error(`GitHub release lookup failed (${response.status}) and tags lookup failed (${tagsResponse.status})`);
  }

  const tags = (await tagsResponse.json()) as Array<{ name?: string }>;
  const semverTags = tags
    .map((t) => extractSemverPrefix(t.name || ''))
    .filter((v): v is string => Boolean(v));

  if (semverTags.length === 0) {
    throw new Error('GitHub tags response did not include semver tags');
  }

  semverTags.sort((a, b) => compareVersions(b, a));
  const latestVersion = semverTags[0];
  return {
    latestVersion,
    releaseUrl: `${GITHUB_URL}/releases/tag/v${latestVersion}`,
  };
}

interface SemverTag {
  version: string;
  commitSha: string;
}

async function fetchSemverTags(): Promise<SemverTag[]> {
  const headers = getGithubHeaders();
  const results: SemverTag[] = [];

  for (let page = 1; page <= TAG_PAGES_TO_SCAN; page += 1) {
    const response = await fetch(`${TAGS_API_URL}&page=${page}`, {
      headers,
    });
    if (!response.ok) {
      break;
    }

    const tags = (await response.json()) as Array<{ name?: string; commit?: { sha?: string } }>;
    if (!Array.isArray(tags) || tags.length === 0) {
      break;
    }

    for (const tag of tags) {
      const version = extractSemverPrefix(tag.name || '');
      const commitSha = (tag.commit?.sha || '').trim();
      if (!version || !commitSha) continue;
      results.push({ version, commitSha });
    }
  }

  return results;
}

async function resolveVersionFromRevision(currentRevision: string): Promise<string | null> {
  const tags = await fetchSemverTags();
  const current = currentRevision.trim().toLowerCase();

  const matches = tags
    .filter((tag) => tag.commitSha.toLowerCase() === current)
    .map((tag) => tag.version);

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => compareVersions(b, a));
  return matches[0];
}

function isSemverLike(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalizeVersion(version));
}

async function isCurrentBehindLatestRelease(latestVersion: string, currentRevision: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${COMPARE_API_URL}/v${latestVersion}...${currentRevision}`, {
      headers: getGithubHeaders(),
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { status?: string };
    const status = String(data.status || '').toLowerCase();

    if (status === 'behind') return true;
    if (status === 'identical' || status === 'ahead') return false;

    return null;
  } catch {
    return null;
  }
}

export async function getAppVersionStatus(force = false): Promise<AppVersionStatus> {
  const now = Date.now();
  if (!force && cache && now - lastCheckMs < CHECK_TTL_MS) {
    return cache;
  }

  const currentVersion = normalizeVersion(getCurrentVersion());
  const currentRevision = (process.env.DOCKWATCH_REVISION || '').trim() || null;

  try {
    const { latestVersion, releaseUrl } = await fetchLatestReleaseVersion();
    let displayVersion = currentVersion;

    if (!isSemverLike(displayVersion) && currentRevision) {
      const resolvedVersion = await resolveVersionFromRevision(currentRevision);
      if (resolvedVersion) {
        displayVersion = resolvedVersion;
      }
    }

    let updateAvailable = false;

    if (isSemverLike(displayVersion)) {
      updateAvailable = compareVersions(latestVersion, displayVersion) > 0;
    } else if (currentRevision) {
      const behind = await isCurrentBehindLatestRelease(latestVersion, currentRevision);
      if (behind !== null) {
        updateAvailable = behind;
      }
    }

    cache = {
      currentVersion: displayVersion,
      currentRevision,
      latestVersion,
      updateAvailable,
      checkedAt: new Date().toISOString(),
      githubUrl: GITHUB_URL,
      releaseUrl,
      checkFailed: false,
    };
    lastCheckMs = now;
    return cache;
  } catch {
    cache = {
      currentVersion,
      currentRevision,
      latestVersion: cache?.latestVersion || null,
      updateAvailable: cache?.updateAvailable || false,
      checkedAt: new Date().toISOString(),
      githubUrl: GITHUB_URL,
      releaseUrl: cache?.releaseUrl || null,
      checkFailed: true,
    };
    lastCheckMs = now;
    return cache;
  }
}
