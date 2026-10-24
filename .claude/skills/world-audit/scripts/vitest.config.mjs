// Конфиг безголовых замеров скилла world-audit (запуск из корня репозитория):
//   npx vitest run --config .claude/skills/world-audit/scripts/vitest.config.mjs density
export default {
  test: {
    include: ['.claude/skills/world-audit/scripts/*.viz.ts'],
    environment: 'node',
    reporters: ['verbose'],
    silent: false,
    testTimeout: 3_600_000,
  },
};
