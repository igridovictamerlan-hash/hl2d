#!/usr/bin/env node
// Вопрос к живой игре: node .claude/skills/playtest/scripts/probe.cjs --expr "<JS-выражение>" [--wait 20] [--repeat 3 --every 10]
//   [--seed …] [--level …|--npcs …] [--role …] [--at x,y | --poi …] [--hour 13] [--setup "<JS до ожидания>"]
// Выражение считается в странице, `game` — window.game; результат печатается как JSON. Примеры:
//   --expr "game.entities.list.filter(c => c.alive).length"
//   --expr "Object.entries(game.entities.list.reduce((m,c)=>{const s=c.brain?.stateName?.split(' ')[0]??'-';m[s]=(m[s]??0)+1;return m},{})).sort((a,b)=>b[1]-a[1]).slice(0,10)"
//   --setup "game.player.health = 1e9"   (бессмертный игрок, чтобы смотреть бой)
const { parseArgs, openGame, placePlayer, setHour } = require('./lib.cjs');

(async () => {
  const a = parseArgs(process.argv.slice(2));
  if (!a.expr) {
    console.error('нужен --expr "<JS>"');
    process.exit(2);
  }
  const { browser, page, errors } = await openGame(a);
  try {
    await placePlayer(page, { at: a.at, poi: a.poi });
    if (a.hour !== undefined) await setHour(page, a.hour);
    if (a.setup) await page.evaluate((code) => { const game = window.game; return eval(code); }, String(a.setup));
    const n = Number(a.repeat ?? 1);
    for (let k = 0; k < n; k++) {
      await page.waitForTimeout(Number(k === 0 ? a.wait ?? 10 : a.every ?? 10) * 1000);
      const res = await page.evaluate((code) => {
        const game = window.game;
        try {
          return { ok: true, value: eval(code), t: game.time };
        } catch (e) {
          return { ok: false, value: String(e), t: game.time };
        }
      }, String(a.expr));
      console.log(`[t=${res.t.toFixed(0)} с] ${res.ok ? JSON.stringify(res.value) : `ошибка: ${res.value}`}`);
    }
    if (errors.length) console.log(`ошибки страницы (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
