import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listStacks: vi.fn(),
  getComposeContent: vi.fn(),
  saveComposeContent: vi.fn(),
  deleteStack: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
  composeRestart: vi.fn(),
  composePull: vi.fn(),
  composeManualUpdate: vi.fn(),
  composeManualUpdateService: vi.fn(),
  composeLogs: vi.fn(),
  composePs: vi.fn(),
  getStackImages: vi.fn(),
  stackDir: vi.fn(),
  notifyStackAction: vi.fn(),
  registerStack: vi.fn(),
  removeStack: vi.fn(),
}));

vi.mock('../src/services/docker.js', () => ({
  listStacks: mocks.listStacks,
  getComposeContent: mocks.getComposeContent,
  saveComposeContent: mocks.saveComposeContent,
  deleteStack: mocks.deleteStack,
  composeUp: mocks.composeUp,
  composeDown: mocks.composeDown,
  composeRestart: mocks.composeRestart,
  composePull: mocks.composePull,
  composeManualUpdate: mocks.composeManualUpdate,
  composeManualUpdateService: mocks.composeManualUpdateService,
  composeLogs: mocks.composeLogs,
  composePs: mocks.composePs,
  getStackImages: mocks.getStackImages,
  stackDir: mocks.stackDir,
}));

vi.mock('../src/services/discord.js', () => ({
  notifyStackAction: mocks.notifyStackAction,
}));

vi.mock('../src/db.js', () => ({
  registerStack: mocks.registerStack,
  removeStack: mocks.removeStack,
}));

const { default: stacksRouter } = await import('../src/routes/stacks.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/stacks', stacksRouter);
  return app;
}

describe('stacks routes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as any).mockReset();
      }
    });
  });

  it('streams stack up action via SSE and marks finish', async () => {
    mocks.composeUp.mockImplementation(async (_name: string, onChunk?: (chunk: string) => void) => {
      onChunk?.('pulling image...\\n');
      onChunk?.('starting container...\\n');
      return 'ok';
    });
    mocks.notifyStackAction.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/stacks/demo/up?stream=true');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('pulling image...');
    expect(res.text).toContain('starting container...');
    expect(res.text).toContain('"finish":true');
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'started', true);
  });

  it('streams service update errors via SSE and reports notify failure action', async () => {
    mocks.composeManualUpdateService.mockRejectedValue(new Error('service update failed'));
    mocks.notifyStackAction.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/stacks/demo/update/app?stream=true');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('service update failed');
    expect(mocks.notifyStackAction).toHaveBeenCalledWith('demo', 'update service app', false);
  });

  it('rejects stack save when content is missing', async () => {
    const res = await request(buildApp()).put('/stacks/demo').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('content (string) is required');
  });

  it('saves stack and registers path', async () => {
    mocks.saveComposeContent.mockResolvedValue(undefined);
    mocks.stackDir.mockReturnValue('/opt/stacks/demo');
    mocks.registerStack.mockReturnValue(undefined);

    const res = await request(buildApp())
      .put('/stacks/demo')
      .send({ content: 'services:\\n  app:\\n    image: nginx:latest\\n' });

    expect(res.status).toBe(200);
    expect(mocks.saveComposeContent).toHaveBeenCalledWith('demo', expect.any(String));
    expect(mocks.registerStack).toHaveBeenCalledWith('demo', '/opt/stacks/demo');
    expect(res.body.ok).toBe(true);
  });
});
