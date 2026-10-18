// Общее для скриптов плейтеста: Playwright, сервер разработки, открыть город и войти в роль.
// Скрипты запускаются из корня репозитория: node .claude/skills/playtest/scripts/<скрипт>.cjs …
const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '../../../..');

/** Аргументы вида --key value / --flag → { key: value, flag: true }. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** Playwright: из проекта, иначе глобальный (в облачном контейнере — /opt/node22/lib/node_modules). */
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return require(path.join(root, 'playwright'));
  }
}

/** Chromium: как настроен Playwright (PLAYWRIGHT_BROWSERS_PATH), иначе предустановленный. Не скачивать браузер. */
async function launch() {
  const { chromium } = loadPlaywright();
  try {
    return await chromium.launch();
  } catch (e) {
    for (const p of ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']) {
      if (fs.existsSync(p)) return chromium.launch({ executablePath: p });
    }
    throw e;
  }
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Сервер разработки на порту: уже поднят — использовать, иначе запустить vite в фоне (лог — /tmp/hl2d-vite.log). */
async function ensureServer(port = 5173) {
  const url = `http://localhost:${port}/`;
  if (await ping(url)) return url;
  const log = fs.openSync('/tmp/hl2d-vite.log', 'a');
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await ping(url)) return url;
  }
  throw new Error(`vite не поднялся на ${port} за 60 с — см. /tmp/hl2d-vite.log`);
}

/** Число из src/config/lighting.ts (сутки и начало) — чтобы ставить нужный час без копии конфига. */
function lightingNumber(key, fallback) {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'src/config/lighting.ts'), 'utf8');
    const m = src.match(new RegExp(`\\b${key}:\\s*([0-9.]+)`));
    return m ? Number(m[1]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Открыть город и войти в роль. opts: seed, level (население: sparse|normal|busy|crowd|max|extreme), npcs (ровно столько
 * граждан), role (citizen|cwu|cp|rebel…), rank, width, height, touch. Возвращает { browser, page, errors }.
 */
async function openGame(opts = {}) {
  const url = await ensureServer(Number(opts.port ?? 5173));
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: Number(opts.width ?? 1280), height: Number(opts.height ?? 800) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (opts.level) await page.addInitScript((lvl) => localStorage.setItem('hl2d-population', lvl), String(opts.level));
  const q = new URLSearchParams();
  q.set('seed', String(opts.seed ?? 12345));
  if (opts.npcs) q.set('npcs', String(opts.npcs));
  if (opts.touch) q.set('touch', '1');
  if (opts.query) for (const kv of String(opts.query).split('&')) q.set(...kv.split('='));
  await page.goto(`${url}?${q}`);
  await page.waitForFunction(() => window.game && window.game.map && window.game.player, null, { timeout: 180000 });
  await page.evaluate(
    ([role, rank]) => {
      const g = window.game;
      g.ui.menu.close();
      g.chooseRole(role, rank);
      g.ui.roles.close();
    },
    [String(opts.role ?? 'citizen'), Number(opts.rank ?? 0)],
  );
  return { browser, page, errors };
}

/** Поставить игрока (и камеру) в точку: at "tx,ty" (тайлы) или poi (тип POI, первый). */
async function placePlayer(page, { at, poi } = {}) {
  return page.evaluate(
    ([at, poi]) => {
      const g = window.game;
      const ts = g.map.tileSize;
      let tx;
      let ty;
      if (at) [tx, ty] = at.split(',').map(Number);
      else if (poi) {
        const p = g.map.poisOf(poi)[0];
        if (!p) return `нет POI ${poi}`;
        tx = p.x + ((p.w ?? 1) >> 1);
        ty = p.y + ((p.h ?? 1) >> 1);
      } else return null;
      g.player.x = g.player.prevX = (tx + 0.5) * ts;
      g.player.y = g.player.prevY = (ty + 0.5) * ts;
      g.camera.snapTo(g.player.x, g.player.y);
      return `${tx},${ty} ${g.map.zoneAtTile(tx, ty)?.name ?? ''}`;
    },
    [at ?? null, poi ?? null],
  );
}

/** Поставить игровые часы (0–24): время игры подгоняется под LIGHTING.start/dayLength. */
async function setHour(page, hour) {
  const start = lightingNumber('start', 0.71);
  const day = lightingNumber('dayLength', 1080);
  await page.evaluate(([h, start, day]) => {
    window.game.time = ((h / 24 - start + 1) % 1) * day;
  }, [Number(hour), start, day]);
}

module.exports = { ROOT, parseArgs, loadPlaywright, launch, ensureServer, openGame, placePlayer, setHour };
