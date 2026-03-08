import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dockerRunToComposeMock = vi.fn();

vi.mock('../src/services/converter.js', () => ({
  dockerRunToCompose: dockerRunToComposeMock,
}));

const { default: convertRouter } = await import('../src/routes/convert.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/convert', convertRouter);
  return app;
}

describe('convert routes', () => {
  beforeEach(() => {
    dockerRunToComposeMock.mockReset();
  });

  it('converts a docker run command to compose output', async () => {
    dockerRunToComposeMock.mockReturnValue('services:\n  app:\n    image: nginx:latest\n');

    const res = await request(buildApp()).post('/convert').send({ command: 'docker run nginx:latest' });

    expect(res.status).toBe(200);
    expect(dockerRunToComposeMock).toHaveBeenCalledWith('docker run nginx:latest');
    expect(res.body.compose).toContain('services:');
  });

  it('rejects missing command payload', async () => {
    const res = await request(buildApp()).post('/convert').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('command (string) is required');
  });

  it('returns 400 when converter throws', async () => {
    dockerRunToComposeMock.mockImplementation(() => {
      throw new Error('invalid docker command');
    });

    const res = await request(buildApp()).post('/convert').send({ command: 'docker run --bad' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid docker command');
  });
});
