import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/application/**/*.ts', 'src/api/middlewares/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/store.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 50,
        branches: 45,
        functions: 50,
        lines: 50,
      },
    },
  },
});
