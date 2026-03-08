import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'src/services/resources.ts',
        'src/middleware/apiRateLimit.ts',
        'src/routes/settings.ts',
        'src/routes/updates.ts',
        'src/routes/stacks.ts',
        'src/routes/cleanup.ts',
        'src/routes/stats.ts',
      ],
      all: true,
      thresholds: {
        lines: 70,
        functions: 85,
        branches: 70,
        statements: 70,
      },
    },
  },
});
