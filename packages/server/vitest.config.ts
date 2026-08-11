import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    env: {
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'postgres',
      // DB_PASSWORD intentionally NOT hardcoded here — dotenv (loaded by src/config)
      // fills it in from the real .env value. A stale hardcoded password here previously
      // shadowed the actual local Postgres credentials and broke every DB-backed test.
      DB_NAME: 'daystream_dev',
      DB_APP_USER: 'daystream_app',
      DB_APP_PASSWORD: 'daystream_app_dev',
      SERVER_PORT: '4001',
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret-for-vitest',
      ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
      AUDIT_SIGNING_KEY: 'test-audit-key',
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations/**', 'src/db/seed.ts', 'src/db/migrate.ts'],
    },
  },
});
