import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the shared workspace package to its TypeScript source so Vite
      // compiles it as ESM directly. Avoids depending on the package's compiled
      // CommonJS `dist` build (which Vite's dep optimizer fails to interop,
      // yielding "does not provide an export named ..." errors). Also means the
      // client picks up shared changes without a separate `shared` build step.
      '@daystream/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 4000,
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
      '/storage': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
});
