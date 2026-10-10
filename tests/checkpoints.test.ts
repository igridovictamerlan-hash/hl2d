import { afterAll, describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { generateCity, validateMap } from '../src/world/generator/CityGenerator';
import { CHECKPOINTS, checkpointRows, pickCheckpointTypes, setForcedCheckpointTypes } from '../src/world/generator/checkpoints';
import { CHECKPOINT_TEMPLATE, CHECKPOINT_STRIP_X } from '../src/world/generator/templates';
import { GENERATOR, type CheckpointType } from '../src/config/generator';
import { T, SOLID, TILE_DEFS } from '../src/world/tiles';
import { lineOfSight } from '../src/world/visibility';
import { AStar } from '../src/ai/AStar';
import { spawnPopulation } from '../src/systems/Population';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { analyzeMap, hatchLinks } from '../src/world/mapStats';
import type { GameMap, Poi } from '../src/world/GameMap';

/**
 * Типы пограничных КПП (generator/checkpoints.ts): у каждого свой шаблон и своя карта частей, а контракт
 * «войны на D» тот же — внешний и внутренний двор, шорт и лонг, проходная без прямой видимости.
 */

const TYPES: CheckpointType[] = ['classic', 'trenches', 'suburb', 'pass'];
const SEEDS = [12345, 777];

afterAll(() => setForcedCheckpointTypes(null));

const cache = new Map<string, GameMap>();
function mapOf(seed: number, west: CheckpointType, east: CheckpointType = west): GameMap {
  const key = `${seed}:${west}:${east}`;
  let m = cache.get(key);
  if (!m) {
    setForcedCheckpointTypes([west, east]);
    try {
      m = generateCity(seed);
    } finally {
      setForcedCheckpointTypes(null);
    }
    cache.set(key, m);
  }
  return m;
}

/** Решётка проходимых клеток шаблона (то же правило, что у стампа: M # B Ж " — непроходимы). */
const SOLID_TEMPLATE_CHARS = new Set(['M', '#', 'B', 'Ж', '"']);

/** Места КПП на карте: POI checkpoint_type (после пустоши координаты уже сдвинуты). */
const cpPois = (map: GameMap): Poi[] => map.poisOf('checkpoint_type').sort((a, b) => a.x - b.x);

/** Заливка якорей 2×2 внутри прямоугольника r от якоря (ax, ay), только по зонам из allowed (null — любым). */
function floodIn(map: GameMap, r: { x: number; y: number; w: number; h: number }, from: [number, number], allowed: Set<number> | null): Uint8Array {
  const w = map.width;
  const seen = new Uint8Array(map.width * map.height);
  const free = (x: number, y: number) => !SOLID[map.tiles[y * w + x]];
  const ok = (ax: number, ay: number) => {
    if (ax < r.x || ay < r.y || ax + 1 >= r.x + r.w || ay + 1 >= r.y + r.h) return false;
    if (!(free(ax, ay) && free(ax + 1, ay) && free(ax, ay + 1) && free(ax + 1, ay + 1))) return false;
    return !allowed || allowed.has(map.zoneGrid[(ay + 1) * w + ax + 1]);
  };
  if (!ok(from[0], from[1])) return seen;
  const q: [number, number][] = [from];
  seen[from[1] * w + from[0]] = 1;
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!ok(nx, ny) || seen[ny * w + nx]) continue;
      seen[ny * w + nx] = 1;
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe('типы КПП: шаблоны', () => {
  test('карты частей совпадают с шаблонами, размеры умеренные, классика не изменилась', () => {
    for (const t of TYPES) {
      const d = CHECKPOINTS[t];
      expect(d.sections).toHaveLength(d.rows.length);
      for (const r of d.rows) expect(r).toHaveLength(d.w);
      for (const r of d.sections) expect(r).toHaveLength(d.w);
      expect(d.w).toBeLessThanOrEqual(80);
      expect(d.h).toBeLessThanOrEqual(32);
      // Ось — на воротах: ряды axisRow-2…axisRow+1 — по 2×4 ворот g с каждой стороны.
      const gateRows = [-2, -1, 0, 1].map((k) => d.rows[d.axisRow + k]);
      for (const r of gateRows) expect(r.match(/g/g)!.length).toBe(4);
      // Общая проходная — столбцы классики от CHECKPOINT_STRIP_X (у классики совпадает с шаблоном).
      for (let y = 0; y < d.h; y++) {
        const strip = d.rows[y].slice(d.w - (CHECKPOINT_TEMPLATE[0].length - CHECKPOINT_STRIP_X));
        const off = d.axisRow - CHECKPOINTS.classic.axisRow;
        expect(strip).toBe(CHECKPOINT_TEMPLATE[y - off]?.slice(CHECKPOINT_STRIP_X) ?? 'M'.repeat(strip.length));
      }
      // Пост-места: 2 во внешней точке, 3 во внутренней, 2 RCT в проходной.
      const count = (ch: string[], part: string) => {
        let n = 0;
        d.rows.forEach((r, y) => [...r].forEach((c, x) => ch.includes(c) && d.sections[y][x] === part && n++));
        return n;
      };
      expect(count(['P', '`'], 'o')).toBe(2);
      expect(count(['P', '`'], 'i')).toBe(3);
      expect(count(['R'], 'g')).toBe(2);
    }
    expect(CHECKPOINTS.classic.rows).toBe(CHECKPOINT_TEMPLATE);
    expect(CHECKPOINTS.classic.w).toBe(66);
    expect(CHECKPOINTS.classic.h).toBe(25);
  });

  test('зеркало восточного КПП: шаблон и карта частей отражены вместе', () => {
    for (const t of TYPES) {
      const d = CHECKPOINTS[t];
      const m = checkpointRows(d, true);
      const o = checkpointRows(d, false);
      expect(m.rows[3]).toBe([...o.rows[3]].reverse().join(''));
      expect(m.sections[3]).toBe([...o.sections[3]].reverse().join(''));
    }
  });

  test('новые тайлы: траншея проходима и прозрачна, пропасть непроходима, но не закрывает обзор', () => {
    const def = (id: number) => TILE_DEFS.find((d) => d.id === id)!;
    expect(def(T.TRENCH)).toMatchObject({ solid: false, opaque: false });
    expect(def(T.CHASM)).toMatchObject({ solid: true, opaque: false });
    const chars = TILE_DEFS.map((d) => d.char);
    expect(new Set(chars).size).toBe(chars.length);
  });
});

describe('выбор типов КПП', () => {
  test('два разных типа из списка, детерминированно по seed; forceTypes — как задано', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const [a, b] = pickCheckpointTypes(seed * 7919);
      expect(a).not.toBe(b);
      expect(GENERATOR.checkpoints.types).toContain(a);
      expect(GENERATOR.checkpoints.types).toContain(b);
      expect(pickCheckpointTypes(seed * 7919)).toEqual([a, b]);
      seen.add(a);
      seen.add(b);
    }
    // За 60 карт встретились все типы.
    expect([...seen].sort()).toEqual([...TYPES].sort());
    setForcedCheckpointTypes(['pass', 'trenches']);
    expect(pickCheckpointTypes(1)).toEqual(['pass', 'trenches']);
    setForcedCheckpointTypes(['suburb']);
    expect(pickCheckpointTypes(1)).toEqual(['suburb', 'suburb']);
    setForcedCheckpointTypes(null);
  });

  test('карта запоминает типы (POI checkpoint_type) и генерация детерминирована', { timeout: 60_000 }, () => {
    const a = mapOf(12345, 'pass', 'trenches');
    const pois = cpPois(a);
    expect(pois.map((p) => p.kind)).toEqual(['pass', 'trenches']);
    expect(pois.map((p) => p.face)).toEqual(['W', 'E']);
    expect([pois[0].w, pois[0].h]).toEqual([CHECKPOINTS.pass.w, CHECKPOINTS.pass.h]);
    expect([pois[1].w, pois[1].h]).toEqual([CHECKPOINTS.trenches.w, CHECKPOINTS.trenches.h]);
    setForcedCheckpointTypes(['pass', 'trenches']);
    const b = generateCity(12345);
    setForcedCheckpointTypes(null);
    expect(Buffer.from(b.tiles).equals(Buffer.from(a.tiles))).toBe(true);
    expect(Buffer.from(b.zoneGrid).equals(Buffer.from(a.zoneGrid))).toBe(true);
  });

  test('без принуждения на карте два разных типа', { timeout: 60_000 }, () => {
    const map = generateCity(4242);
    const kinds = cpPois(map).map((p) => p.kind);
    expect(kinds).toHaveLength(2);
    expect(kinds[0]).not.toBe(kinds[1]);
    expect(kinds).toEqual(pickCheckpointTypes(4242));
  });
});

for (const type of TYPES) {
  describe(`КПП «${CHECKPOINTS[type].name}» (${type})`, () => {
    for (const seed of SEEDS) {
      test(`seed ${seed}: части, посты, ворота, связность`, { timeout: 120_000 }, () => {
        const map = mapOf(seed, type);
        expect(validateMap(map)).toEqual([]);
        const check = analyzeMap(map.tiles as Uint8Array, map.width, map.height, hatchLinks(map));
        expect(check.components).toBe(1);
        expect(check.unreachableTiles).toBe(0);

        const pois = cpPois(map);
        expect(pois).toHaveLength(2);
        const posts = map.poisOf('checkpoint_post');
        const gatePosts = map.poisOf('gate_post');
        const def = CHECKPOINTS[type];
        const w = map.width;

        pois.forEach((p, k) => {
          const mirror = k === 1;
          expect(p.kind).toBe(type);
          const rect = { x: p.x, y: p.y, w: p.w!, h: p.h! };
          const { rows, sections } = checkpointRows(def, mirror);

          // Карта на месте шаблона: ничего не засыпано связностью и не прорыто.
          const changed: string[] = [];
          for (let y = 0; y < rect.h; y++) {
            for (let x = 0; x < rect.w; x++) {
              const solid = SOLID_TEMPLATE_CHARS.has(rows[y][x]);
              if ((SOLID[map.tiles[(rect.y + y) * w + rect.x + x]] === 1) !== solid) changed.push(`${x},${y}`);
            }
          }
          expect(changed, 'клетки шаблона, изменённые связностью').toEqual([]);

          // Зоны по частям: пять на КПП, каждая со своими якорями.
          const zoneAt = (x: number, y: number) => map.zoneGrid[y * w + x];
          const byPart = new Map<string, number>();
          for (let y = 0; y < rect.h; y++) {
            for (let x = 0; x < rect.w; x++) {
              const part = sections[y][x];
              const z = zoneAt(rect.x + x, rect.y + y);
              if (part === '-') expect(map.zones[z].kind).toBe('outlands');
              else {
                expect(map.zones[z].kind).toBe('checkpoint');
                if (byPart.has(part)) expect(byPart.get(part)).toBe(z);
                byPart.set(part, z);
              }
            }
          }
          expect(byPart.size).toBe(5);
          const names = Object.fromEntries([...byPart].map(([c, z]) => [c, map.zones[z].name]));
          expect(names.o).toMatch(/ · D[35]$/);
          expect(names.i).toMatch(/ · D[46]$/);
          expect(names.s).toMatch(/ · шорт$/);
          expect(names.l).toMatch(/ · лонг$/);
          expect(names.g).toMatch(/ · проходная$/);

          // Лонг свободен: в нём нет бетонных блоков (правило войны на D — WarSystem/RebelBrain обходят по лонгу колонной).
          let longBlocks = 0;
          for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) if (sections[y][x] === 'l' && map.tiles[(rect.y + y) * w + rect.x + x] === T.BARRIER) longBlocks++;
          expect(longBlocks, 'блоков в лонге').toBe(0);

          // Посты: 2 во внешней точке, 3 во внутренней, 2 RCT в проходной; ворота g — по 8 тайлов в обеих точках.
          const inRect = (q: { x: number; y: number }) => q.x >= rect.x && q.y >= rect.y && q.x < rect.x + rect.w && q.y < rect.y + rect.h;
          const partOf = (q: { x: number; y: number }) => sections[q.y - rect.y][q.x - rect.x];
          expect(posts.filter(inRect).map(partOf).sort().join('')).toBe('iiioo');
          expect(gatePosts.filter(inRect).map(partOf).join('')).toBe('gg');
          let outerGates = 0;
          let innerGates = 0;
          for (let y = 0; y < rect.h; y++) {
            for (let x = 0; x < rect.w; x++) {
              if (map.tiles[(rect.y + y) * w + rect.x + x] !== T.GATE) continue;
              if (sections[y][x] === 'o') outerGates++;
              if (sections[y][x] === 'i') innerGates++;
            }
          }
          expect([outerGates, innerGates]).toEqual([8, 8]);

          // Проход от пустоши до края у проспекта; шорт и лонг каждый сам по себе ведут из внешней точки во внутреннюю.
          const axisY = rect.y + def.axisRow;
          const startX = mirror ? rect.x + rect.w - 3 : rect.x;
          const endX = mirror ? rect.x : rect.x + rect.w - 3;
          const all = floodIn(map, rect, [startX, axisY - 1], null);
          expect(all[(axisY - 1) * w + endX], 'от пустоши до проспекта').toBe(1);
          const zone = (c: string) => byPart.get(c)!;
          for (const [lane, other] of [['s', 'l'], ['l', 's']] as const) {
            // У классического шаблона вход лонга во внутренний двор перекрыт блоком B (x 45, ряд 7) — не меняем.
            if (type === 'classic' && lane === 'l') continue;
            const ok = new Set([zone('o'), zone('i'), zone(lane)]);
            ok.add(zoneAt(startX + 1, axisY));
            const seen = floodIn(map, rect, [startX, axisY - 1], ok);
            let innerReached = 0;
            for (let y = 0; y < rect.h; y++) {
              for (let x = 0; x < rect.w; x++) {
                const gx = rect.x + x;
                const gy = rect.y + y;
                if (seen[gy * w + gx] && zoneAt(gx + 1, gy + 1) === zone('i')) innerReached++;
              }
            }
            expect(innerReached, `${lane === 's' ? 'шорт' : 'лонг'} ведёт во внутренний двор (в обход ${other})`).toBeGreaterThan(30);
          }
        });
      });

      test(`seed ${seed}: «война на D» строит два фронта с обеими точками; проходная не просматривается`, { timeout: 120_000 }, () => {
        const map = mapOf(seed, type);
        const sim = makeSim(map);
        const { nav } = sim;
        // Двери настежь: остаётся только «зигзаг» стены.
        map.doorClosed.fill(0);
        expect(sim.war.fronts).toHaveLength(2);
        for (const f of sim.war.fronts) {
          expect(f.points).toHaveLength(2);
          const [d3, d4] = f.points;
          expect(map.zones[d3.zone].name).toMatch(/ · D[35]$/);
          expect(map.zones[d4.zone].name).toMatch(/ · D[46]$/);
          expect(d3.posts).toHaveLength(2);
          expect(d4.posts).toHaveLength(3);
          expect(f.posts).toHaveLength(5);
          expect(d3.floor.length).toBeGreaterThan(20);
          expect(d4.floor.length).toBeGreaterThan(20);
          // Шорт и лонг опознаны правильно (шорт ближе к оси) и оба проходимы.
          expect(map.zones[f.shortZone].name).toMatch(/ · шорт$/);
          expect(map.zones[f.longZone].name).toMatch(/ · лонг$/);
          expect(f.short.length).toBeGreaterThan(5);
          expect(f.long.length).toBeGreaterThan(5);
          // Ворота: внешние ближе к пустоши, внутренние — ближе к проспекту; точки D по ним.
          expect(Math.hypot(f.outerGate.x - f.exit.x, f.outerGate.y - f.exit.y)).toBeLessThan(Math.hypot(f.innerGate.x - f.exit.x, f.innerGate.y - f.exit.y));
          // Проходная.
          expect(f.gatehouse).toBeGreaterThanOrEqual(0);
          expect(f.gatePosts).toHaveLength(2);
          expect([f.shortZone, f.longZone, d3.zone, d4.zone]).not.toContain(f.gatehouse);
          expect(f.outlands.length).toBeGreaterThan(20);
          expect(f.bunker.length).toBeGreaterThan(0);
          expect(map.zoneAtWorld(f.apron.x, f.apron.y)?.kind).not.toBe('checkpoint');
          // Боевой ИИ ходит по A*: от пустоши до внешней точки, оттуда во внутреннюю и из неё к проспекту за проходной.
          const astar = new AStar(nav);
          const mid = (list: number[]) => list[Math.floor(list.length / 2)];
          expect(astar.find(f.outlands[0], mid(d3.floor)), 'пустошь → D3').not.toBeNull();
          expect(astar.find(mid(d3.floor), mid(d4.floor)), 'D3 → D4').not.toBeNull();
          expect(astar.find(mid(d4.floor), nav.nearestWalkable(f.apron.x, f.apron.y, 6)), 'D4 → проспект').not.toBeNull();
          // Проспект за дверью не виден ни из одной точки внутреннего двора.
          const city = nav.walkable.filter((a) => {
            const x = nav.worldX(a);
            const y = nav.worldY(a);
            return map.zoneAtWorld(x, y)?.kind === 'avenue' && Math.hypot(x - f.apron.x, y - f.apron.y) < 160;
          });
          expect(city.length).toBeGreaterThan(5);
          for (const a of d4.floor) {
            for (const b of city) expect(lineOfSight(map, nav.worldX(a), nav.worldY(a), nav.worldX(b), nav.worldY(b))).toBe(false);
          }
        }
      });
    }
  });
}

describe('война на разных КПП', () => {
  for (const type of TYPES) {
    test(`${type}: внешний двор у повстанцев — звенья идут на внутренний шортом и лонгом, перестрелка идёт`, { timeout: 300_000 }, () => {
      const sim = makeSim(mapOf(12345, type));
      spawnPopulation(sim.ctx, 10);
      const f = sim.war.fronts[0];
      // Внешний двор уже у повстанцев (гарнизон перебит): наступление сразу идёт на внутренний.
      f.held = 1;
      f.retakeAt = Infinity;
      for (const c of sim.entities.list) if (c.alive && c.role?.kind === 'guard' && sim.war.sectionAt(f, c.x, c.y) === 0) sim.combat.damage(c, 99999, null, null, true);
      sim.war.command.launchOffensive(0);
      const reached = new Set<number>();
      const lanes = new Set<number>();
      let wasInYard = false;
      for (let t = 0; t < 200 * 60; t++) {
        sim.step();
        if (t % 30 !== 0) continue;
        for (const c of sim.entities.list) {
          if (!c.alive || c.faction !== 'rebel' || !(c.brain instanceof RebelBrain)) continue;
          const sec = sim.war.sectionAt(f, c.x, c.y);
          if (sec >= 0) reached.add(sec);
          const z = sim.map.zoneAtWorld(c.x, c.y)?.id;
          if (z === f.shortZone) lanes.add(0);
          if (z === f.longZone) lanes.add(1);
          if (z === f.points[1].zone) wasInYard = true;
        }
      }
      // Повстанцы вошли в шорт или лонг и добрались до внутреннего двора — застрявших в траншеях и рытвинах нет.
      expect(reached.has(1), 'были в шорте/лонге').toBe(true);
      expect(wasInYard, 'были во внутреннем дворе').toBe(true);
      expect(sim.combat.downs + sim.combat.bledOut, 'перестрелка шла: были тяжело раненые').toBeGreaterThan(0);
    });
  }
});

describe('разные типы на одной карте', () => {
  test('запад — перевал, восток — ничейная полоса: оба фронта целы, города не видно из дворов', { timeout: 120_000 }, () => {
    const map = mapOf(12345, 'pass', 'trenches');
    expect(validateMap(map)).toEqual([]);
    const sim = makeSim(map);
    expect(sim.war.fronts).toHaveLength(2);
    const [a, b] = sim.war.fronts;
    // Запад левее востока; у каждого свой тип по положению.
    expect(a.exit.x).toBeLessThan(b.exit.x);
    const kinds = cpPois(map).map((p) => p.kind);
    expect(kinds).toEqual(['pass', 'trenches']);
    // Чужая часть не мешает: у пересекающихся полотен нет общей стены и каждый КПП ведёт к проспекту.
    const check = analyzeMap(map.tiles as Uint8Array, map.width, map.height, hatchLinks(map));
    expect(check.components).toBe(1);
    expect(check.unreachableTiles).toBe(0);
  });
});
