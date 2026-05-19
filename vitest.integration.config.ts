import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'cdk.out/**'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
