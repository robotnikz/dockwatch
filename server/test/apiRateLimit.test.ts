import { describe, expect, it, vi } from 'vitest';
import { createApiRateLimit } from '../src/middleware/apiRateLimit.js';

function makeResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe('api rate limit middleware', () => {
  it('allows requests up to configured max', () => {
    const middleware = createApiRateLimit({ windowMs: 1000, maxRequests: 2 });
    const next = vi.fn();

    middleware({ ip: '1.1.1.1', socket: { remoteAddress: '1.1.1.1' } } as any, makeResponse() as any, next as any);
    middleware({ ip: '1.1.1.1', socket: { remoteAddress: '1.1.1.1' } } as any, makeResponse() as any, next as any);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('rejects requests over configured max with retry header', () => {
    const middleware = createApiRateLimit({ windowMs: 60_000, maxRequests: 1 });
    const next = vi.fn();

    middleware({ ip: '2.2.2.2', socket: { remoteAddress: '2.2.2.2' } } as any, makeResponse() as any, next as any);

    const blockedRes = makeResponse();
    middleware({ ip: '2.2.2.2', socket: { remoteAddress: '2.2.2.2' } } as any, blockedRes as any, next as any);

    expect(next).toHaveBeenCalledTimes(1);
    expect(blockedRes.statusCode).toBe(429);
    expect(blockedRes.headers['Retry-After']).toBeDefined();
    expect(blockedRes.body).toEqual({ error: 'Too many requests' });
  });

  it('resets count after window elapsed', () => {
    const middleware = createApiRateLimit({ windowMs: 10, maxRequests: 1 });
    const next = vi.fn();

    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1000);
    middleware({ ip: '3.3.3.3', socket: { remoteAddress: '3.3.3.3' } } as any, makeResponse() as any, next as any);

    nowSpy.mockReturnValue(1015);
    middleware({ ip: '3.3.3.3', socket: { remoteAddress: '3.3.3.3' } } as any, makeResponse() as any, next as any);

    expect(next).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });
});
