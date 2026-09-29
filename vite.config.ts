import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Генерация города — до 32 попыток (у некоторых сидов — несколько секунд): 5 с по умолчанию мало.
    testTimeout: 30_000,
  },
});
