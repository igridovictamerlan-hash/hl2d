#!/usr/bin/env node
// Скриншот игры: node .claude/skills/playtest/scripts/shot.cjs --out /tmp/a.png [--seed 12345] [--at 192,162 | --poi plaza_center]
//   [--hour 13] [--zoom 0..] [--wait 3] [--level crowd | --npcs 40] [--role citizen] [--nofog] [--nohud] [--width 1280 --height 800]
//   [--js "game.camera.cycleZoom()"]  — выполнить в странице перед снимком (window.game доступен как game).
// Печатает, где стоял игрок, и ошибки страницы (если были). Несколько снимков одного города — --shots "x,y,hour;x,y,hour".
const { parseArgs, openGame, placePlayer, setHour } = require('./lib.cjs');

(async () => {
  const a = parseArgs(process.argv.slice(2));
  if (!a.out) {
    console.error('нужен --out путь.png');
    process.exit(2);
  }
  const { browser, page, errors } = await openGame(a);
  try {
    if (a.nofog) await page.evaluate(() => (window.game.fog.draw = () => {}));
    if (a.nohud) await page.addStyleTag({ content: '#ui { display: none !important; }' });
    const shots = a.shots ? String(a.shots).split(';') : [null];
    for (let k = 0; k < shots.length; k++) {
      const spec = shots[k];
      let at = a.at;
      let hour = a.hour;
      if (spec) {
        const [x, y, h] = spec.split(',');
        at = `${x},${y}`;
        if (h !== undefined) hour = h;
      }
      const where = await placePlayer(page, { at, poi: a.poi });
      if (hour !== undefined) await setHour(page, hour);
      if (k === 0 && a.zoom) await page.evaluate((n) => { for (let i = 0; i < n; i++) window.game.camera.cycleZoom(); }, Number(a.zoom));
      if (a.js) await page.evaluate((code) => { const game = window.game; return eval(code); }, String(a.js));
      await page.waitForTimeout(Number(a.wait ?? 3) * 1000);
      const out = shots.length > 1 ? String(a.out).replace(/(\.png)?$/, `_${k}.png`) : String(a.out);
      await page.screenshot({ path: out });
      console.log(`снимок ${out}${where ? ` · игрок ${where}` : ''}${hour !== undefined ? ` · ${hour} ч` : ''}`);
    }
    if (errors.length) console.log(`ошибки страницы (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
