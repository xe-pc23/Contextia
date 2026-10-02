import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@contextia/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      '@contextia/test-fixtures': fileURLToPath(new URL('../../packages/test-fixtures/src/index.ts', import.meta.url))
    }
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true }
});
