// Конфиг превью карты (запуск из корня репозитория):
//   npx vitest run --config .claude/skills/map-preview/scripts/vitest.config.mjs map
export default {
  test: {
    include: ['.claude/skills/map-preview/scripts/*.viz.ts'],
    environment: 'node',
    reporters: ['verbose'],
    silent: false,
    testTimeout: 600_000,
  },
};
