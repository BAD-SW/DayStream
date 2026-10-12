import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Ports come from the repo-root .env (shared with the server) so they can be
  // changed locally without editing this file.
  const env = loadEnv(mode, '../..', '');
  const clientPort = Number(env.CLIENT_PORT) || 4000;
  const apiTarget = `http://localhost:${Number(env.SERVER_PORT) || 4001}`;

  return {
    plugins: [react()],
    resolve: {
      // @daystream/shared's dist/ is CommonJS (built for the Node server), which
      // the dev server can't serve as ESM — consume its TypeScript source instead.
      alias: {
        '@daystream/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      },
    },
    server: {
      port: clientPort,
      // Fail loudly instead of silently hopping onto the API's port.
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/storage': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
