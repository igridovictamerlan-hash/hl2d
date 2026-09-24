import { expect, test } from 'vitest';
(globalThis as { __HL2D_DEBUG_GEN?: boolean }).__HL2D_DEBUG_GEN = !!process.env.DEBUG_GEN;
const { generateCity, validateMap } = await import('../src/world/generator/CityGenerator');

/**
 * Регрессия генератора по многим сидам + сводная таблица метрик (npm run mapstats).
 * DEBUG_GEN=1 — печатать причины отбракованных попыток.
 */
test('сводка метрик по сидам', { timeout: 120_000 }, () => {
  const n = Number(process.env.SEEDS ?? 30);
  const rows: string[] = [];
  const bad: string[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const map = generateCity(seed * 7919);
    const s = map.stats!;
    const problems = validateMap(map);
    if (s.longestAlleyRun > 25) problems.push(`прямая ${s.longestAlleyRun}`);
    if (problems.length) bad.push(`${seed * 7919}: ${problems.join('; ')}`);
    rows.push(
      [
        String(seed * 7919).padStart(7),
        `att ${s.attempt}`,
        `bld ${(s.buildingRatio * 100).toFixed(1)}%`,
        `run ${s.longestAlleyRun}`,
        `av ${s.avenues}`,
        `dead ${s.deadEnds}`,
        `narrow ${s.chokepoints}`,
        `court ${s.courtyards}`,
        `pass ${s.passages}/${s.arches}`,
        `comp ${s.initialComponents}→${s.components}`,
        `tun ${s.tunnels}`,
        `fill ${s.fragmentsFilled}/${s.unreachableRemoved}`,
        `${s.genMs}ms`,
        problems.join('; '),
      ].join(' | '),
    );
  }
  console.log(rows.join('\n'));
  expect(bad).toEqual([]);
});
