import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@contextia/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@contextia/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
      '@contextia/providers': fileURLToPath(new URL('./packages/providers/src/index.ts', import.meta.url)),
      '@contextia/test-fixtures': fileURLToPath(new URL('./packages/test-fixtures/src/index.ts', import.meta.url)),
      '@contextia/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['packages/**/*.{test,spec}.{ts,tsx}', 'apps/**/*.{test,spec}.{ts,tsx}', 'infra/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', '**/.git/**'],
    testTimeout: 30_000
  }
});
