import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true, port: 5173 },
  // Шрифты меню (woff2 до 100 КБ) встраиваются в сборку — игра открывается без интернета.
  build: { target: 'es2022', sourcemap: true, assetsInlineLimit: 100_000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Генерация города — до 32 попыток (у некоторых сидов — несколько секунд): 5 с по умолчанию мало.
    testTimeout: 30_000,
  },
});
