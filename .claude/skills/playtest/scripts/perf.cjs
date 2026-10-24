#!/usr/bin/env node
// Замер в живой игре: node .claude/skills/playtest/scripts/perf.cjs [--seed 12345] [--level crowd] [--poi plaza_center | --at x,y]
//   [--samples 6] [--every 10] [--levels normal,crowd,extreme]
// Раз в --every с: живых, тик логики (скользящее среднее Game.tickMs, мс), такт упрощённой симуляции (LOD every/farEvery),
// кадров в секунду (requestAnimationFrame). --levels — несколько уровней населения подряд, каждый в своём браузере.
// Игрок по умолчанию на площади (самое людное место). В облачном контейнере кадров мало: видеокарты нет, рисует процессор.
const { parseArgs, openGame, placePlayer } = require('./lib.cjs');

async function measure(a, level) {
  const { browser, page, errors } = await openGame({ ...a, level });
  try {
    await placePlayer(page, { at: a.at, poi: a.at ? undefined : a.poi ?? 'plaza_center' });
    const rows = [];
    const n = Number(a.samples ?? 6);
    const every = Number(a.every ?? 10);
    for (let k = 0; k < n; k++) {
      await page.waitForTimeout(every * 1000);
      rows.push(
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const g = window.game;
              let frames = 0;
              const t0 = performance.now();
              const tick = () => {
                frames++;
                if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
                else {
                  const alive = g.entities.list.filter((c) => c.alive).length;
                  const lod = g.ai.lod;
                  resolve({ alive, tick: g.tickMs, every: lod?.every, far: lod?.farEvery, fps: (frames * 1000) / (performance.now() - t0) });
                }
              };
              requestAnimationFrame(tick);
            }),
        ),
      );
    }
    const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    for (const r of rows) console.log(`  ${level ?? '(по умолчанию)'} · живых ${r.alive} · тик ${r.tick.toFixed(2)} мс · LOD ${r.every}/${r.far} · ${r.fps.toFixed(0)} к/с`);
    console.log(`ИТОГ ${level ?? '(по умолчанию)'}: живых ~${Math.round(avg((r) => r.alive))}, тик ${avg((r) => r.tick).toFixed(2)} мс (${Math.min(...rows.map((r) => r.tick)).toFixed(1)}–${Math.max(...rows.map((r) => r.tick)).toFixed(1)}), ${avg((r) => r.fps).toFixed(0)} к/с`);
    if (errors.length) console.log(`ошибки страницы (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
  } finally {
    await browser.close();
  }
}

(async () => {
  const a = parseArgs(process.argv.slice(2));
  const levels = a.levels ? String(a.levels).split(',') : [a.level];
  for (const level of levels) await measure(a, level);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
