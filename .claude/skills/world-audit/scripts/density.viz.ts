// Тепловая карта толпы и занятия у площади — безголовый город на MIN игровых минут (как в игре: распорядок, драки,
// академия; сид, население и районная жизнь — из переменных окружения). Запуск из корня репозитория:
//   TAG=after MIN=12 npx vitest run --config .claude/skills/world-audit/scripts/vitest.config.mjs density
// Переменные: SEED (12345), MIN — игровых минут (12 ≈ 16 игровых часов), START — час начала (7), SCALE — множитель
// городских ролей (4 = «много» в меню, 1 = состав тестов), HOODS=0 — без районной жизни, CP=classic — прежняя карта КПП,
// LINE=0 — без линии армии, CELL — ячейка в тайлах (6), NEAR — «у площади», тайлов (50), MAXV — нормировка картинки
// (людей в ячейке = самый яркий цвет; по умолчанию — свой максимум), OUT — каталог (/tmp/hl2d-audit).
// Результат: OUT/heat_<TAG>.png (город без канализации, площадь — жёлтая метка и круг NEAR), OUT/heat_<TAG>.json (средняя
// плотность и подложка — compare.py перерисует несколько прогонов с общей нормировкой) и OUT/density_<TAG>.txt (сводка).
// Работает и на старых версиях кода (рабочая копия из baseline.sh): необязательные системы — через ?.
import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeSim } from '../../../../tests/simHarness';
import { spawnPopulation } from '../../../../src/systems/Population';
import { AI } from '../../../../src/config/ai';
import { LIGHTING } from '../../../../src/config/lighting';
import { MINIMAP } from '../../../../src/config/minimap';
import { writePng } from './png';

const env = process.env;
const OUT = (env.OUT ?? '/tmp/hl2d-audit').replace(/\/?$/, '/');
const TAG = env.TAG ?? 'run';
// Задержанные (LawPhase): ведут в камеру или сидят — у площади это КПЗ Управы, а не толпа.
const CUSTODY = new Set(['cuffed', 'entering', 'jailed', 'releasing']);

test('density', () => {
  mkdirSync(OUT, { recursive: true });
  (LIGHTING as { start: number }).start = Number(env.START ?? 7) / 24;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sim: any = (makeSim as any)(Number(env.SEED ?? 12345), { checkpoints: env.CP === 'classic' ? ['classic'] : null, line: env.LINE !== '0' });
  const ctx = sim.ctx;
  if (ctx.routine) ctx.routine.enabled = true;
  if (ctx.brawls) ctx.brawls.enabled = true;
  if (sim.academy) sim.academy.recruiting = true;
  const hoods = env.HOODS !== '0';
  if (ctx.hoods) ctx.hoods.enabled = hoods;
  if (ctx.crowd) ctx.crowd.enabled = hoods;
  const scale = Number(env.SCALE ?? 4);
  spawnPopulation(ctx, Math.round(AI.citizens * scale), scale);

  const map = sim.map;
  const ts = map.tileSize;
  const cityW = Math.floor(map.levelBounds('city').w / ts);
  const C = Number(env.CELL ?? 6);
  const NEAR = Number(env.NEAR ?? 50);
  const gw = Math.ceil(cityW / C);
  const gh = Math.ceil(map.height / C);
  const heat = new Float64Array(gw * gh);
  const pc = map.poisOf('plaza_center')[0];
  const cityKinds = new Set(['citizen', 'cwu', 'vort', 'cp', 'admin']);
  const residents = new Set(['citizen', 'cwu', 'vort']);
  const zoneTot = new Map<string, number>();
  // По часам (целым): замеров, жителей, у площади (без задержанных), задержанных у площади, на улице.
  const hours = new Map<number, { n: number; res: number; near: number; held: number; out: number; all: number }>();
  // По 4-часовым корзинам: состояния жителей у площади.
  const nearStates = new Map<number, Map<string, number>>();
  const nearN = new Map<number, number>();
  let n = 0;
  let peak = 0;
  let peakWhere = '';
  let peakRes = 0;
  let peakResWhere = '';
  let resSum = 0;
  let nearSum = 0;
  let heldSum = 0;
  const minutes = Number(env.MIN ?? 12);
  const where = (k: number) => `${(k % gw) * C},${Math.floor(k / gw) * C} ${map.zoneAtTile((k % gw) * C + (C >> 1), Math.floor(k / gw) * C + (C >> 1))?.name ?? ''}`;
  for (let t = 1; t <= minutes * 3600; t++) {
    sim.step();
    if (t % 180) continue;
    n++;
    const hour = ctx.routine?.hour?.() ?? 0;
    const hb = Math.floor(hour / 4) * 4;
    nearN.set(hb, (nearN.get(hb) ?? 0) + 1);
    const h = hours.get(Math.floor(hour)) ?? { n: 0, res: 0, near: 0, held: 0, out: 0, all: 0 };
    h.n++;
    hours.set(Math.floor(hour), h);
    const snap = new Float64Array(gw * gh);
    const snapRes = new Float64Array(gw * gh);
    for (const c of sim.entities.list) {
      if (!c.alive || !cityKinds.has(c.faction) || map.levelAt(c.x, c.y) !== 'city') continue;
      const z = map.zoneAtWorld(c.x, c.y);
      if (!z || z.kind === 'checkpoint' || z.kind === 'outlands' || z.kind === 'wasteland') continue;
      const tx = Math.floor(c.x / ts);
      const ty = Math.floor(c.y / ts);
      if (tx >= cityW) continue;
      const k = Math.floor(ty / C) * gw + Math.floor(tx / C);
      snap[k]++;
      heat[k]++;
      h.all++;
      if (sim.war?.outdoors?.(c)) h.out++;
      zoneTot.set(`${z.kind}:${z.name}`, (zoneTot.get(`${z.kind}:${z.name}`) ?? 0) + 1);
      if (!residents.has(c.faction)) continue;
      const held = CUSTODY.has(c.law?.phase);
      if (!held) snapRes[k]++;
      h.res++;
      resSum++;
      if (!pc || Math.hypot(tx - pc.x, ty - pc.y) >= NEAR) continue;
      if (held) {
        h.held++;
        heldSum++;
        continue;
      }
      h.near++;
      nearSum++;
      const st = `${c.faction}:${c.brain?.stateName?.split(' ')[0] ?? c.brain?.constructor?.name ?? '-'}`;
      const m = nearStates.get(hb) ?? new Map<string, number>();
      m.set(st, (m.get(st) ?? 0) + 1);
      nearStates.set(hb, m);
    }
    for (let k = 0; k < snap.length; k++) {
      if (snap[k] > peak) {
        peak = snap[k];
        peakWhere = where(k);
      }
      if (snapRes[k] > peakRes) {
        peakRes = snapRes[k];
        peakResWhere = where(k);
      }
    }
  }

  const avg = Float64Array.from(heat, (v) => v / n);
  const cells = [...avg].map((v, k) => ({ k, v })).sort((a, b) => b.v - a.v);
  const own = cells[0]?.v ?? 1;
  const maxv = Number(env.MAXV ?? own) || 1;
  const hot = cells.slice(0, 15).map(({ k, v }) => `${v.toFixed(1)} чел · ${where(k)}`);
  const zones = [...zoneTot].map(([z, v]) => [z, v / n] as const).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([z, v]) => `${v.toFixed(1)} ${z}`);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const perHour = [...hours]
    .sort((a, b) => a[0] - b[0])
    .map(([hh, v]) => `${String(hh).padStart(2)} ч: в городе ${Math.round(v.all / v.n)}, на улице ${Math.round(v.out / v.n)}, жителей ${Math.round(v.res / v.n)}, у площади ${Math.round(v.near / v.n)} (${pct(v.near, v.res)}%)${v.held ? `, задержанных там ${Math.round(v.held / v.n)}` : ''}`);
  const byState = [...nearStates]
    .sort((a, b) => a[0] - b[0])
    .map(([hb, m]) => {
      const k = nearN.get(hb) ?? 1;
      const total = [...m.values()].reduce((s, v) => s + v, 0) / k;
      return `у площади ${hb}–${hb + 4} ч (всего ${total.toFixed(1)}): ${[...m].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([s, v]) => `${s} ${(v / k).toFixed(1)}`).join(', ')}`;
    });

  // Подложка — цвета мини-карты потемнее (1 пиксель на тайл, в JSON для compare.py), картинка — ×2 с плотностью.
  const base = new Uint8Array(cityW * map.height * 3);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < cityW; x++) {
      const [r, g, b] = (MINIMAP.tiles as Record<number, number[]>)[map.tiles[y * map.width + x]] ?? [255, 0, 255];
      const o = (y * cityW + x) * 3;
      base[o] = r * 0.55;
      base[o + 1] = g * 0.55;
      base[o + 2] = b * 0.55;
    }
  }
  const S = 2;
  const W = cityW * S;
  const H = map.height * S;
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < cityW; x++) {
      const o = (y * cityW + x) * 3;
      let r = base[o];
      let g = base[o + 1];
      let b = base[o + 2];
      const v = avg[Math.floor(y / C) * gw + Math.floor(x / C)] / maxv;
      if (v > 0.02) {
        const a = Math.min(1, Math.sqrt(v));
        r = r * (1 - a) + 255 * a;
        g = g * (1 - a) + (230 - 200 * Math.min(1, v)) * a;
        b = b * (1 - a) + 40 * a;
      }
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const p = ((y * S + dy) * W + x * S + dx) * 3;
          rgb[p] = r;
          rgb[p + 1] = g;
          rgb[p + 2] = b;
        }
      }
    }
  }
  if (pc) {
    // Площадь: жёлтый квадрат и пунктирный круг «у площади» (NEAR тайлов).
    const put = (X: number, Y: number) => {
      if (X < 0 || Y < 0 || X >= W || Y >= H) return;
      const p = (Y * W + X) * 3;
      rgb[p] = 255;
      rgb[p + 1] = 235;
      rgb[p + 2] = 60;
    };
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) put(pc.x * S + dx, pc.y * S + dy);
    for (let a = 0; a < 720; a++) if (a % 12 < 7) put(Math.round(pc.x * S + Math.cos((a * Math.PI) / 360) * NEAR * S), Math.round(pc.y * S + Math.sin((a * Math.PI) / 360) * NEAR * S));
  }
  writePng(`${OUT}heat_${TAG}.png`, W, H, rgb);
  writeFileSync(
    `${OUT}heat_${TAG}.json`,
    JSON.stringify({ tag: TAG, seed: Number(env.SEED ?? 12345), cell: C, gw, gh, width: cityW, height: map.height, near: NEAR, plaza: pc ? [pc.x, pc.y] : null, max: own, heat: [...avg].map((v) => +v.toFixed(3)), base: Buffer.from(base).toString('base64') }),
  );
  const alive = sim.entities.list.filter((c: { alive: boolean }) => c.alive).length;
  writeFileSync(
    `${OUT}density_${TAG}.txt`,
    [
      `[${TAG}] сид ${env.SEED ?? 12345}, ${minutes} мин с ${env.START ?? 7} ч, SCALE ${scale}, районы ${ctx.hoods ? (hoods ? 'вкл' : 'выкл') : 'нет в этой версии'}, всего живых ${alive}`,
      `самая людная ячейка ${C}×${C}: ${peak} (${peakWhere}); жителей (без задержанных) — ${peakRes} (${peakResWhere}); средняя самой людной ${own.toFixed(1)}; нормировка картинки ${maxv.toFixed(1)}`,
      `у площади (ближе ${NEAR} тайлов) в среднем ${(nearSum / n).toFixed(1)} жителей из ${(resSum / n).toFixed(1)} (${pct(nearSum, resSum)}%), задержанных там ещё ${(heldSum / n).toFixed(1)} (КПЗ Управы — не толпа)`,
      '--- по часам (средние) ---',
      ...perHour,
      '--- чем заняты жители у площади (средние, все состояния в сумме «всего») ---',
      ...byState,
      '--- горячие ячейки (в среднем людей, с ВС) ---',
      ...hot,
      '--- зоны (в среднем людей) ---',
      ...zones,
    ].join('\n') + '\n',
  );
  console.log(`density: ${OUT}heat_${TAG}.png, ${OUT}heat_${TAG}.json, ${OUT}density_${TAG}.txt`);
});
