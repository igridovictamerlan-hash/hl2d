import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
