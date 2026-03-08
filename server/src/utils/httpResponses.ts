import type { Response } from 'express';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  return fallback;
}

export function badRequest(res: Response, message: string) {
  res.status(400).json({ error: message });
}

export function conflict(res: Response, message: string) {
  res.status(409).json({ error: message });
}

export function internalServerError(res: Response, err: unknown, fallback = 'Internal server error') {
  res.status(500).json({ error: errorMessage(err, fallback) });
}
