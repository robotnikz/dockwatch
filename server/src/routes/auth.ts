import { Router, type Request, type Response } from 'express';
import {
  buildAuthMe,
  createAuthSession,
  getAuthCookieName,
  getAuthCookieOptions,
  getAuthenticatedUsernameFromToken,
  getConfiguredAuthUsername,
  getSessionTokenFromCookieHeader,
  invalidateSessionToken,
  invalidateSessionsForUser,
  isAuthConfigured,
  setAuthCredentials,
  validatePassword,
  validateUsername,
  verifyAuthCredentials,
} from '../services/auth.js';

const router = Router();

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return proto.split(',').map((part) => part.trim()).includes('https');
}

function getCurrentUser(req: Request): string | null {
  const token = getSessionTokenFromCookieHeader(req.headers.cookie);
  if (!token) return null;
  return getAuthenticatedUsernameFromToken(token);
}

router.get('/me', (req: Request, res: Response) => {
  const user = getCurrentUser(req);
  res.json(buildAuthMe(user));
});

router.post('/setup', (req: Request, res: Response) => {
  if (isAuthConfigured()) {
    res.status(400).json({ error: 'Auth is already configured' });
    return;
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!validateUsername(username)) {
    res.status(400).json({ error: 'Username must be 3-32 chars and only contain letters, numbers, _, ., -' });
    return;
  }
  if (!validatePassword(password)) {
    res.status(400).json({ error: 'Password must be between 8 and 256 characters' });
    return;
  }

  setAuthCredentials(username, password);
  const token = createAuthSession(username);
  res.cookie(getAuthCookieName(), token, getAuthCookieOptions(isSecureRequest(req)));
  res.json({ ok: true, me: buildAuthMe(username) });
});

router.post('/login', (req: Request, res: Response) => {
  if (!isAuthConfigured()) {
    res.status(400).json({ error: 'Auth is not configured yet' });
    return;
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!verifyAuthCredentials(username, password)) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const token = createAuthSession(username);
  res.cookie(getAuthCookieName(), token, getAuthCookieOptions(isSecureRequest(req)));
  res.json({ ok: true, me: buildAuthMe(username) });
});

router.post('/logout', (req: Request, res: Response) => {
  const token = getSessionTokenFromCookieHeader(req.headers.cookie);
  if (token) invalidateSessionToken(token);
  res.clearCookie(getAuthCookieName(), { path: '/' });
  res.json({ ok: true });
});

router.post('/change-password', (req: Request, res: Response) => {
  const username = getCurrentUser(req);
  if (!username) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }

  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (!verifyAuthCredentials(username, currentPassword)) {
    res.status(400).json({ error: 'Current password is incorrect' });
    return;
  }

  if (!validatePassword(newPassword)) {
    res.status(400).json({ error: 'New password must be between 8 and 256 characters' });
    return;
  }

  setAuthCredentials(username, newPassword);
  invalidateSessionsForUser(username);
  const newToken = createAuthSession(username);
  res.cookie(getAuthCookieName(), newToken, getAuthCookieOptions(isSecureRequest(req)));
  res.json({ ok: true, me: buildAuthMe(username) });
});

router.get('/username', (_req: Request, res: Response) => {
  res.json({ username: getConfiguredAuthUsername() });
});

export default router;
