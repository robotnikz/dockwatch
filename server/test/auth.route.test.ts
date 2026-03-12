import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildAuthMe: vi.fn(),
  createAuthSession: vi.fn(),
  getAuthCookieName: vi.fn(),
  getAuthCookieOptions: vi.fn(),
  getAuthenticatedUsernameFromToken: vi.fn(),
  getConfiguredAuthUsername: vi.fn(),
  getSessionTokenFromCookieHeader: vi.fn(),
  invalidateSessionToken: vi.fn(),
  invalidateSessionsForUser: vi.fn(),
  isAuthConfigured: vi.fn(),
  isAuthEnabled: vi.fn(),
  setAuthCredentials: vi.fn(),
  validatePassword: vi.fn(),
  validateUsername: vi.fn(),
  verifyAuthCredentials: vi.fn(),
}));

vi.mock('../src/services/auth.js', () => ({
  buildAuthMe: mocks.buildAuthMe,
  createAuthSession: mocks.createAuthSession,
  getAuthCookieName: mocks.getAuthCookieName,
  getAuthCookieOptions: mocks.getAuthCookieOptions,
  getAuthenticatedUsernameFromToken: mocks.getAuthenticatedUsernameFromToken,
  getConfiguredAuthUsername: mocks.getConfiguredAuthUsername,
  getSessionTokenFromCookieHeader: mocks.getSessionTokenFromCookieHeader,
  invalidateSessionToken: mocks.invalidateSessionToken,
  invalidateSessionsForUser: mocks.invalidateSessionsForUser,
  isAuthConfigured: mocks.isAuthConfigured,
  isAuthEnabled: mocks.isAuthEnabled,
  setAuthCredentials: mocks.setAuthCredentials,
  validatePassword: mocks.validatePassword,
  validateUsername: mocks.validateUsername,
  verifyAuthCredentials: mocks.verifyAuthCredentials,
}));

const { default: authRouter } = await import('../src/routes/auth.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

describe('auth routes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as any).mockReset();
      }
    });

    mocks.getAuthCookieName.mockReturnValue('dockwatch_session');
    mocks.getAuthCookieOptions.mockReturnValue({ path: '/', httpOnly: true });
    mocks.buildAuthMe.mockImplementation((username: string | null) => ({
      enabled: true,
      configured: true,
      authenticated: Boolean(username),
      username,
    }));
  });

  it('returns auth me response', async () => {
    mocks.getSessionTokenFromCookieHeader.mockReturnValue('token');
    mocks.getAuthenticatedUsernameFromToken.mockReturnValue('admin');

    const res = await request(buildApp()).get('/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.username).toBe('admin');
  });

  it('supports setup when auth is enabled and unconfigured', async () => {
    mocks.isAuthEnabled.mockReturnValue(true);
    mocks.isAuthConfigured.mockReturnValue(false);
    mocks.validateUsername.mockReturnValue(true);
    mocks.validatePassword.mockReturnValue(true);
    mocks.createAuthSession.mockReturnValue('session-token');

    const res = await request(buildApp()).post('/auth/setup').send({ username: 'admin', password: 'password123' });

    expect(res.status).toBe(200);
    expect(mocks.setAuthCredentials).toHaveBeenCalledWith('admin', 'password123');
    expect(mocks.createAuthSession).toHaveBeenCalledWith('admin');
    expect(res.body.ok).toBe(true);
  });

  it('rejects invalid login credentials', async () => {
    mocks.isAuthEnabled.mockReturnValue(true);
    mocks.isAuthConfigured.mockReturnValue(true);
    mocks.verifyAuthCredentials.mockReturnValue(false);

    const res = await request(buildApp()).post('/auth/login').send({ username: 'admin', password: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid username or password');
  });

  it('changes password for authenticated user', async () => {
    mocks.isAuthEnabled.mockReturnValue(true);
    mocks.getSessionTokenFromCookieHeader.mockReturnValue('token');
    mocks.getAuthenticatedUsernameFromToken.mockReturnValue('admin');
    mocks.verifyAuthCredentials.mockReturnValue(true);
    mocks.validatePassword.mockReturnValue(true);
    mocks.createAuthSession.mockReturnValue('new-token');

    const res = await request(buildApp())
      .post('/auth/change-password')
      .send({ currentPassword: 'old-pass', newPassword: 'new-pass-123' });

    expect(res.status).toBe(200);
    expect(mocks.setAuthCredentials).toHaveBeenCalledWith('admin', 'new-pass-123');
    expect(mocks.invalidateSessionsForUser).toHaveBeenCalledWith('admin');
    expect(res.body.ok).toBe(true);
  });

  it('logs out and clears cookie', async () => {
    mocks.getSessionTokenFromCookieHeader.mockReturnValue('token');

    const res = await request(buildApp()).post('/auth/logout');

    expect(res.status).toBe(200);
    expect(mocks.invalidateSessionToken).toHaveBeenCalledWith('token');
    expect(res.body.ok).toBe(true);
  });
});
