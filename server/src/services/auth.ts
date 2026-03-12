import crypto from 'node:crypto';
import {
  deleteAuthSessionByTokenHash,
  deleteAuthSessionsForUser,
  deleteExpiredAuthSessions,
  getAuthSessionByTokenHash,
  getSetting,
  insertAuthSession,
  setSetting,
  touchAuthSession,
} from '../db.js';

const AUTH_COOKIE_NAME = 'dockwatch_session';
const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthMe {
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

interface ParsedPasswordHash {
  algorithm: string;
  salt: string;
  hash: string;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function isAuthEnabled(): boolean {
  // Built-in auth is always enabled; setup state is persisted in the database.
  return true;
}

export function getConfiguredAuthUsername(): string {
  const fromSettings = String(getSetting('auth_username') || '').trim();
  if (fromSettings) return fromSettings;
  return 'admin';
}

export function isAuthConfigured(): boolean {
  return Boolean(getSetting('auth_password_hash'));
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 3) return null;
  const [algorithm, salt, hash] = parts;
  if (!algorithm || !salt || !hash) return null;
  return { algorithm, salt, hash };
}

function encodePasswordHash(algorithm: string, salt: string, hash: string): string {
  return `${algorithm}$${salt}$${hash}`;
}

function derivePasswordHash(password: string, saltHex: string): string {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

export function validateUsername(username: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
}

export function validatePassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 8 && password.length <= 256;
}

export function setAuthCredentials(username: string, password: string): void {
  const normalizedUsername = String(username || '').trim();
  if (!validateUsername(normalizedUsername)) {
    throw new Error('Username must be 3-32 chars and only contain letters, numbers, _, ., -');
  }
  if (!validatePassword(password)) {
    throw new Error('Password must be between 8 and 256 characters');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = derivePasswordHash(password, salt);
  setSetting('auth_username', normalizedUsername);
  setSetting('auth_password_hash', encodePasswordHash('scrypt', salt, hash));
}

export function verifyAuthCredentials(username: string, password: string): boolean {
  const configuredUsername = getConfiguredAuthUsername();
  if (username !== configuredUsername) return false;

  const encoded = String(getSetting('auth_password_hash') || '');
  const parsed = parsePasswordHash(encoded);
  if (!parsed || parsed.algorithm !== 'scrypt') return false;

  const actual = derivePasswordHash(password, parsed.salt);
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(parsed.hash, 'hex'));
}

export function createAuthSession(username: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = toIso(Date.now() + AUTH_SESSION_TTL_MS);
  insertAuthSession(tokenHash, username, expiresAt);
  return token;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

export function getSessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  const cookies = parseCookies(cookieHeader);
  return cookies[AUTH_COOKIE_NAME] || null;
}

export function getAuthenticatedUsernameFromToken(token: string): string | null {
  const nowIso = toIso(Date.now());
  deleteExpiredAuthSessions(nowIso);

  const tokenHash = hashToken(token);
  const session = getAuthSessionByTokenHash(tokenHash);
  if (!session) return null;

  if (session.expires_at <= nowIso) {
    deleteAuthSessionByTokenHash(tokenHash);
    return null;
  }

  touchAuthSession(tokenHash);
  return session.username;
}

export function invalidateSessionToken(token: string): void {
  deleteAuthSessionByTokenHash(hashToken(token));
}

export function invalidateSessionsForUser(username: string): void {
  deleteAuthSessionsForUser(username);
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function getAuthCookieOptions(secure = false) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: AUTH_SESSION_TTL_MS,
  };
}

export function buildAuthMe(username: string | null): AuthMe {
  const enabled = isAuthEnabled();
  const configured = isAuthConfigured();

  if (!enabled) {
    return { enabled: false, configured: false, authenticated: true, username: null };
  }

  return {
    enabled,
    configured,
    authenticated: Boolean(username),
    username,
  };
}
