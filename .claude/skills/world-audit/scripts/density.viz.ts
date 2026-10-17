// Тепловая карта толпы и занятия у площади — безголовый город на MIN игровых минут (как в игре: распорядок, драки,
// академия; сид, население и районная жизнь — из переменных окружения). Запуск из корня репозитория:
//   TAG=after MIN=12 npx vitest run --config .claude/skills/world-audit/scripts/vitest.config.mjs density
// Переменные: SEED (12345), MIN — игровых минут (12 ≈ 16 игровых часов), START — час начала (7), SCALE — множитель
// городских ролей (4 = «много» в меню, 1 = состав тестов), HOODS=0 — без районной жизни, CP=classic — прежняя карта КПП,
// LINE=0 — без линии армии, CELL — ячейка в тайлах (6), NEAR — «у площади», тайлов (50), MAXV — нормировка картинки
// (людей в ячейке = самый яркий цвет; для честного «до/после» поставь обоим одну), OUT — каталог (/tmp/hl2d-audit).
// Результат: OUT/heat_<TAG>.png (только город, без канализации) и OUT/density_<TAG>.txt (сводка).
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
  const nearStates = new Map<number, Map<string, number>>();
  const nearN = new Map<number, number>();
  const lines: string[] = [];
  let n = 0;
  let peak = 0;
  let peakWhere = '';
  const minutes = Number(env.MIN ?? 12);
  for (let t = 1; t <= minutes * 3600; t++) {
    sim.step();
    if (t % 180) continue;
    n++;
    const hour = ctx.routine?.hour?.() ?? 0;
    const hb = Math.floor(hour / 4) * 4;
    nearN.set(hb, (nearN.get(hb) ?? 0) + 1);
    const snap = new Float64Array(gw * gh);
    let all = 0;
    let out = 0;
    let near = 0;
    let res = 0;
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
      all++;
      if (sim.war?.outdoors?.(c)) out++;
      zoneTot.set(`${z.kind}:${z.name}`, (zoneTot.get(`${z.kind}:${z.name}`) ?? 0) + 1);
      if (!residents.has(c.faction)) continue;
      res++;
      if (pc && Math.hypot(tx - pc.x, ty - pc.y) < NEAR) {
        near++;
        const st = `${c.faction}:${c.brain?.stateName?.split(' ')[0] ?? c.brain?.constructor?.name ?? '-'}`;
        const m = nearStates.get(hb) ?? new Map<string, number>();
        m.set(st, (m.get(st) ?? 0) + 1);
        nearStates.set(hb, m);
      }
    }
    for (let k = 0; k < snap.length; k++) {
      if (snap[k] <= peak) continue;
      peak = snap[k];
      peakWhere = `${(k % gw) * C},${Math.floor(k / gw) * C} ${map.zoneAtTile((k % gw) * C + (C >> 1), Math.floor(k / gw) * C + (C >> 1))?.name ?? ''}`;
    }
    if (n % 20 === 0) lines.push(`${hour.toFixed(1)} ч: в городе ${all}, на улице ${out}, жителей ${res}, из них у площади ${near} (${res ? Math.round((near / res) * 100) : 0}%)`);
  }

  const cells = [...heat].map((v, k) => ({ k, v: v / n })).sort((a, b) => b.v - a.v);
  const own = cells[0]?.v ?? 1;
  const maxv = Number(env.MAXV ?? own) || 1;
  const hot = cells.slice(0, 15).map(({ k, v }) => {
    const x = (k % gw) * C + (C >> 1);
    const y = Math.floor(k / gw) * C + (C >> 1);
    return `${v.toFixed(1)} чел · ${map.zoneAtTile(x, y)?.name ?? '?'} (${x},${y})`;
  });
  const zones = [...zoneTot].map(([z, v]) => [z, v / n] as const).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([z, v]) => `${v.toFixed(1)} ${z}`);
  const byHour = [...nearStates]
    .sort((a, b) => a[0] - b[0])
    .map(([h, m]) => `у площади ${h}–${h + 4} ч: ${[...m].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${(v / (nearN.get(h) ?? 1)).toFixed(1)}`).join(', ')}`);

  // Картинка: карта мини-карты потемнее, сверху — жёлто-красное по средней плотности (корень — видно и слабые места).
  const S = 2;
  const W = cityW * S;
  const H = map.height * S;
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < cityW; x++) {
      let [r, g, b] = (MINIMAP.tiles as Record<number, number[]>)[map.tiles[y * map.width + x]] ?? [255, 0, 255];
      r *= 0.55;
      g *= 0.55;
      b *= 0.55;
      const v = heat[Math.floor(y / C) * gw + Math.floor(x / C)] / n / maxv;
      if (v > 0.02) {
        const a = Math.min(1, Math.sqrt(v));
        r = r * (1 - a) + 255 * a;
        g = g * (1 - a) + (230 - 200 * Math.min(1, v)) * a;
        b = b * (1 - a) + 40 * a;
      }
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const o = ((y * S + dy) * W + x * S + dx) * 3;
          rgb[o] = r;
          rgb[o + 1] = g;
          rgb[o + 2] = b;
        }
      }
    }
  }
  writePng(`${OUT}heat_${TAG}.png`, W, H, rgb);
  writeFileSync(
    `${OUT}density_${TAG}.txt`,
    [
      `[${TAG}] сид ${env.SEED ?? 12345}, ${minutes} мин с ${env.START ?? 7} ч, SCALE ${scale}, районы ${ctx.hoods ? (hoods ? 'вкл' : 'выкл') : 'нет в этой версии'}, всего живых ${sim.entities.list.filter((c: { alive: boolean }) => c.alive).length}`,
      `самая людная ячейка ${C}×${C}: ${peak} (${peakWhere}); средняя самой людной ${own.toFixed(1)}; нормировка картинки ${maxv.toFixed(1)}`,
      ...lines,
      ...byHour,
      '--- горячие ячейки (в среднем людей) ---',
      ...hot,
      '--- зоны (в среднем людей) ---',
      ...zones,
    ].join('\n') + '\n',
  );
  console.log(`density: ${OUT}heat_${TAG}.png, ${OUT}density_${TAG}.txt`);
});
