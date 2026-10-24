import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { createCharacter } from '../src/entities/factory';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { OtaBrain } from '../src/ai/brains/OtaBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { WAR } from '../src/config/war';
import { ITEMS } from '../src/config/items';
import type { Character } from '../src/entities/Character';
import { generateCity, validateMap } from '../src/world/generator/CityGenerator';
import { CHECKPOINTS, checkpointRows, dugoutsOf, setForcedCheckpointTypes } from '../src/world/generator/checkpoints';
import { type CheckpointType, GENERATOR } from '../src/config/generator';
import { T, SOLID } from '../src/world/tiles';
import { canSeeCircle, lineOfSight } from '../src/world/visibility';
import { NavGrid } from '../src/world/NavGrid';
import { AStar } from '../src/ai/AStar';
import { analyzeMap, hatchLinks } from '../src/world/mapStats';
import type { GameMap, Poi } from '../src/world/GameMap';

/**
 * Передовые блиндажи повстанцев (generator/checkpoints.ts, символы Σ Θ Δ Π Ξ шаблонов): у каждого пограничного
 * КПП любого типа (оба у западной стены; зеркало для пустоши с востока — задел), в полосе пустоши — закрытая землянка с одним входом,
 * ящиком и местами отдыха, невидимая с постов, и ход сообщения (траншея) от входа к краю полосы у КПП.
 */

const TYPES: CheckpointType[] = ['classic', 'trenches', 'suburb', 'pass'];
const SEEDS = [12345, 777];

afterAll(() => setForcedCheckpointTypes(null));

const cache = new Map<string, GameMap>();
function mapOf(seed: number, type: CheckpointType): GameMap {
  const key = `${seed}:${type}`;
  let m = cache.get(key);
  if (!m) {
    setForcedCheckpointTypes([type, type]);
    try {
      m = generateCity(seed);
    } finally {
      setForcedCheckpointTypes(null);
    }
    cache.set(key, m);
  }
  return m;
}

type Rect = { x: number; y: number; w: number; h: number };
// Оба КПП — у западной стены: порядок «Север», «Юг» (сверху вниз); зеркальным (пустошь с востока) был бы КПП с face 'E'.
const cpRects = (map: GameMap): (Rect & { poi: Poi })[] =>
  map.poisOf('checkpoint_type').sort((a, b) => a.y - b.y).map((p) => ({ x: p.x, y: p.y, w: p.w!, h: p.h!, poi: p }));
const inRect = (r: Rect) => (p: { x: number; y: number }) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

/** Якоря 2×2, целиком лежащие на тайлах из набора kinds (центр якоря (ax, ay) — стык четырёх тайлов). */
function floodAnchors(map: GameMap, from: [number, number], kinds: ReadonlySet<number>): Set<number> {
  const w = map.width;
  const ok = (ax: number, ay: number) => {
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) if (!kinds.has(map.tiles[(ay + dy) * w + ax + dx])) return false;
    return true;
  };
  const seen = new Set<number>();
  if (!ok(from[0], from[1])) return seen;
  const q: [number, number][] = [from];
  seen.add(from[1] * w + from[0]);
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!ok(nx, ny) || seen.has(ny * w + nx)) continue;
      seen.add(ny * w + nx);
      q.push([nx, ny]);
    }
  }
  return seen;
}

for (const type of TYPES) {
  describe(`блиндаж на КПП «${CHECKPOINTS[type].name}» (${type})`, () => {
    for (const seed of SEEDS) {
      test(`seed ${seed}: есть у обоих КПП, внутри не виден с постов, вход один, пол не уже двух тайлов`, { timeout: 120_000 }, () => {
        const map = mapOf(seed, type);
        expect(validateMap(map)).toEqual([]);
        const def = CHECKPOINTS[type];
        const rects = cpRects(map);
        expect(rects).toHaveLength(2);
        const w = map.width;
        rects.forEach((r) => {
          const mirror = r.poi.face === 'E';
          const { rows } = checkpointRows(def, mirror);
          const expected = dugoutsOf(rows);
          expect(expected).toHaveLength(1);
          const poi = map.poisOf('dugout').filter(inRect(r));
          expect(poi).toHaveLength(1);
          const d = poi[0];
          const want = expected[0];
          expect([d.x - r.x, d.y - r.y, d.w, d.h, d.face]).toEqual([want.x, want.y, want.w, want.h, want.face]);
          // Вход смотрит от КПП: у зеркального — в другую сторону по горизонтали, а не на пост.
          expect(d.w!).toBeGreaterThanOrEqual(2);
          expect(d.h!).toBeGreaterThanOrEqual(2);
          if (d.face === 'W' || d.face === 'E') expect(d.face).toBe(mirror ? 'E' : 'W');

          // Ящик и места отдыха — внутри пола; пол — T.DUGOUT, в зоне пустоши; вокруг — сруб.
          const inFloor = (p: { x: number; y: number }) => p.x >= d.x && p.y >= d.y && p.x < d.x + d.w! && p.y < d.y + d.h!;
          expect(map.poisOf('dugout_cache').filter(inFloor)).toHaveLength(1);
          const bunks = map.poisOf('dugout_bunk').filter(inFloor);
          expect(bunks.length).toBeGreaterThanOrEqual(GENERATOR.validation.dugoutBunks);
          expect(bunks.length).toBeLessThanOrEqual(3);
          for (let y = d.y; y < d.y + d.h!; y++) {
            for (let x = d.x; x < d.x + d.w!; x++) {
              expect(map.tileAt(x, y), `пол ${x},${y}`).toBe(T.DUGOUT);
              expect(map.zoneAtTile(x, y)?.kind).toBe('outlands');
            }
          }
          // Кольцо стен вокруг пола, в нём — только проём шириной не меньше 2 (одна сторона).
          let door = 0;
          const side = new Set<string>();
          for (let y = d.y - 1; y <= d.y + d.h!; y++) {
            for (let x = d.x - 1; x <= d.x + d.w!; x++) {
              const inside = x >= d.x && x < d.x + d.w! && y >= d.y && y < d.y + d.h!;
              if (inside) continue;
              const corner = (x < d.x || x >= d.x + d.w!) && (y < d.y || y >= d.y + d.h!);
              if (corner) {
                expect(map.tileAt(x, y)).toBe(T.DUGOUT_WALL);
                continue;
              }
              const t = map.tileAt(x, y);
              expect([T.DUGOUT_WALL, T.DUGOUT]).toContain(t);
              if (t === T.DUGOUT) {
                door++;
                side.add(y < d.y ? 'N' : y >= d.y + d.h! ? 'S' : x < d.x ? 'W' : 'E');
              }
            }
          }
          expect(door, 'клеток проёма').toBeGreaterThanOrEqual(2);
          expect([...side], 'проём на одной стороне').toEqual([d.face]);

          // Невидим ни с одного поста КПП (и с постов проходной): ни по центру, ни краем кружка бойца.
          const ts = map.tileSize;
          const posts = [...map.poisOf('checkpoint_post'), ...map.poisOf('gate_post')].filter(inRect(r));
          expect(posts.length).toBeGreaterThanOrEqual(7);
          for (const p of posts) {
            const px = (p.x + 0.5) * ts;
            const py = (p.y + 0.5) * ts;
            for (let y = d.y; y < d.y + d.h!; y++) {
              for (let x = d.x; x < d.x + d.w!; x++) {
                const cx = (x + 0.5) * ts;
                const cy = (y + 0.5) * ts;
                expect(lineOfSight(map, px, py, cx, cy), `пост ${p.x},${p.y} видит ${x},${y}`).toBe(false);
                expect(canSeeCircle(map, px, py, cx, cy, 6), `пост ${p.x},${p.y} видит краем ${x},${y}`).toBe(false);
              }
            }
          }

          // Проём 2 тайла: якорь 2×2 проходит насквозь (сверка со связностью карты).
          const check = analyzeMap(map.tiles as Uint8Array, w, map.height, hatchLinks(map));
          expect(check.unreachableTiles).toBe(0);
        });
      });

      test(`seed ${seed}: от лагеря сопротивления по тропе в блиндаж и ходом сообщения к краю полосы у КПП`, { timeout: 120_000 }, () => {
        const map = mapOf(seed, type);
        const def = CHECKPOINTS[type];
        const nav = new NavGrid(map);
        const astar = new AStar(nav);
        const camp = map.poisOf('rebel_camp')[0];
        const ts = map.tileSize;
        const from = nav.nearestWalkable((camp.x + 0.5) * ts, (camp.y + 0.5) * ts, 6);
        expect(from).toBeGreaterThanOrEqual(0);
        cpRects(map).forEach((r) => {
          const mirror = r.poi.face === 'E';
          const d = map.poisOf('dugout').filter(inRect(r))[0];
          // Якорь внутри блиндажа: тайл (d.x + 1, d.y + 1) и тайлы справа-снизу, чтобы вошёл 2×2.
          const to = nav.nearestWalkable((d.x + d.w! / 2) * ts, (d.y + d.h! / 2) * ts, 2);
          expect(to).toBeGreaterThanOrEqual(0);
          const path = astar.find(from, to);
          expect(path, 'путь от лагеря в блиндаж').not.toBeNull();
          // Весь путь внутри полосы — открытая местность или траншея (никаких обходов через КПП): последние
          // якоря пути — в зоне пустоши.
          const last = path![path!.length - 1];
          expect(map.zones[nav.zone[last]]?.kind).toBe('outlands');

          // Ход сообщения: заливка якорей по траншее и полу блиндажа от самого блиндажа достигает передней кромки полосы
          // (столбец у КПП) — боец дойдёт от землянки до огневых позиций, не выходя на открытое место.
          const kinds = new Set<number>([T.TRENCH, T.DUGOUT]);
          const seed0 = (() => {
            for (let ay = d.y; ay < d.y + d.h! - 1; ay++) for (let ax = d.x; ax < d.x + d.w! - 1; ax++) if (floodAnchors(map, [ax, ay], kinds).size) return [ax, ay] as [number, number];
            return null;
          })();
          expect(seed0, 'якорь 2×2 в блиндаже').not.toBeNull();
          const reach = floodAnchors(map, seed0!, kinds);
          const frontX = mirror ? r.x + r.w - def.outlandsW : r.x + def.outlandsW - 1;
          let nearEdge = false;
          let trenchAnchors = 0;
          for (const key of reach) {
            const ax = key % map.width;
            const ay = Math.floor(key / map.width);
            if (map.tiles[ay * map.width + ax] === T.TRENCH) trenchAnchors++;
            if (Math.abs(ax - frontX) <= 1 || Math.abs(ax + 1 - frontX) <= 1) nearEdge = true;
          }
          expect(trenchAnchors, 'якорей траншеи в ходе сообщения').toBeGreaterThanOrEqual(6);
          expect(nearEdge, 'ход доходит до передней кромки полосы').toBe(true);
        });
      });
    }
  });
}

describe('передовые блиндажи: огневые позиции линии (held 0)', () => {
  const MIN: Record<CheckpointType, number> = { classic: 10, trenches: 12, suburb: 0, pass: 4 };
  test('позиций линии перед КПП не меньше, чем без блиндажа и хода сообщения', { timeout: 300_000 }, () => {
    const counts: string[] = [];
    for (const type of TYPES) {
      const sim = makeSim(mapOf(12345, type), { line: true });
      for (const f of sim.war.fronts) {
        const p0 = sim.war.linePositions(f, 0);
        const p1 = sim.war.linePositions(f, 1);
        counts.push(`${type}#${f.index}: held0=${p0.length} held1=${p1.length}`);
        expect(p0.length, `${type} КПП ${f.index} held 0`).toBeGreaterThanOrEqual(MIN[type]);
        // Позиции — только вне блиндажа: оттуда нет обзора постов.
        for (const p of [...p0, ...p1]) expect(sim.map.tileAt(Math.floor(p.x / 16), Math.floor(p.y / 16))).not.toBe(T.DUGOUT);
        // Пустошь фронта (сбор, разведка, позиции) без пола и порога блиндажа: армия внутри не собирается.
        expect(f.outlands.length).toBeGreaterThan(40);
        for (const a of f.outlands) {
          const ax = sim.nav.ax(a);
          const ay = sim.nav.ay(a);
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(sim.map.tileAt(ax + dx, ay + dy)).not.toBe(T.DUGOUT);
        }
      }
    }
    console.log(`позиции линии (held 0/1): ${counts.join('; ')}`);
  });
});

describe('передовые блиндажи: шаблоны', () => {
  test('в каждом шаблоне один блиндаж, внутри — ящик и 2–3 места отдыха, вход один; блиндаж в полосе пустоши', () => {
    for (const type of TYPES) {
      const def = CHECKPOINTS[type];
      for (const mirror of [false, true]) {
        const { rows, sections } = checkpointRows(def, mirror);
        const ds = dugoutsOf(rows);
        expect(ds, type).toHaveLength(1);
        const d = ds[0];
        // Сам блиндаж и всё, что к нему примыкает, — часть «пустошь» ('-'), а не двор КПП.
        for (let y = d.y - 1; y <= d.y + d.h; y++) {
          for (let x = d.x - 1; x <= d.x + d.w; x++) expect(sections[y][x], `${type} ${x},${y}`).toBe('-');
        }
        const flat = rows.join('');
        expect((flat.match(/Ξ/g) ?? []).length).toBe(1);
        expect((flat.match(/Π/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((flat.match(/Π/g) ?? []).length).toBeLessThanOrEqual(3);
        // Пол блиндажа не уже двух тайлов в каждом ряду и столбце.
        for (let y = d.y; y < d.y + d.h; y++) expect([...rows[y].slice(d.x, d.x + d.w)].every((c) => 'ΘΞΠ'.includes(c))).toBe(true);
        expect(SOLID[T.DUGOUT_WALL]).toBe(1);
        expect(SOLID[T.DUGOUT]).toBe(0);
      }
    }
  });
});

// ───────────────────────── Логика блиндажа (systems/Dugouts.ts, WAR.dugout) ─────────────────────────

type Sim = ReturnType<typeof makeSim>;

const SEED = 12345;
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const LINE0 = clone(WAR.line);
const DUG0 = clone(WAR.dugout);
const restoreWar = () => {
  const deep = (to: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) deep(to[k] as Record<string, unknown>, v as Record<string, unknown>);
      else to[k] = v;
    }
  };
  deep(WAR.line as unknown as Record<string, unknown>, clone(LINE0) as unknown as Record<string, unknown>);
  deep(WAR.dugout as unknown as Record<string, unknown>, clone(DUG0) as unknown as Record<string, unknown>);
};
afterAll(restoreWar);
// Каждому тесту — исходные числа; свои тест правит до front() (блиндаж берёт стартовые значения при сборке карты).
beforeEach(restoreWar);

/** Город с армией и линией; наступлений нет, подполье молчит, потерь-пауз нет. Типы КПП и население — как в positional.test.ts. */
function front(type: CheckpointType = 'trenches', population = true): Sim {
  Object.assign(WAR.line.losses, { count: 999 });
  const sim = makeSim(SEED, { checkpoints: [type], line: true });
  if (population) spawnPopulation(sim.ctx, 10);
  sim.insurgency.paused = true;
  sim.war.command.nextOffensive = Infinity;
  return sim;
}

const run = (sim: Sim, secs: number, each: () => void = () => undefined) => {
  for (let i = 0; i < secs * 60; i++) {
    sim.step();
    each();
  }
};
/** Крутить мир, пока cond не станет истиной (не дольше secs); сколько секунд ушло, -1 — не дождались. */
const until = (sim: Sim, cond: () => boolean, secs: number): number => {
  for (let i = 0; i < secs * 60; i++) {
    sim.step();
    if (cond()) return (i + 1) / 60;
  }
  return -1;
};
const brain = (c: Character) => c.brain as RebelBrain;
/** Здоровый боец линии 0-го фронта на позиции (ранило или лежит — не годится для опытов с патронами). */
const seatedHolder = (sim: Sim): Character | undefined =>
  sim.war.command.lineOf(sim.war.fronts[0]).find((c) => brain(c).lineHere && c.fit && c.health >= c.maxHealth * 0.9 && !c.downed);
const inRoom = (sim: Sim, c: Character, pad = 0) => {
  const d = sim.war.dugouts.of(0)!;
  const ts = sim.map.tileSize;
  return c.x >= (d.rect.x - pad) * ts && c.y >= (d.rect.y - pad) * ts && c.x < (d.rect.x + d.rect.w + pad) * ts && c.y < (d.rect.y + d.rect.h + pad) * ts;
};
const ammoItems = (c: Character) => c.inventory.slots.filter((s) => ITEMS[s.id].kind === 'ammo').map((s) => ({ id: s.id, qty: s.qty }));

describe('блиндаж: состояние и сборка по карте', () => {
  test('у каждого фронта свой блиндаж с койками, ящиком и начальным запасом; свет гаснет с разрушением', { timeout: 120_000 }, () => {
    const sim = front('classic', false);
    const D = sim.war.dugouts;
    expect(D.list).toHaveLength(2);
    expect(new Set(D.list.map((d) => d.index)).size).toBe(2);
    for (const d of D.list) {
      expect(d.owner).toBe('rebels');
      expect(d.bunks.length).toBeGreaterThanOrEqual(2);
      expect(d.kits).toBe(WAR.dugout.stock.kits.start);
      expect(d.grenades).toBe(WAR.dugout.stock.grenades.start);
      // Ящик, койки и середина — внутри пола; якоря проходимы.
      const inFloor = (x: number, y: number) => x >= d.rect.x * 16 && y >= d.rect.y * 16 && x < (d.rect.x + d.rect.w) * 16 && y < (d.rect.y + d.rect.h) * 16;
      expect(inFloor(d.cache.x, d.cache.y)).toBe(true);
      for (const k of d.bunks) {
        expect(inFloor(k.x, k.y)).toBe(true);
        expect(k.anchor).toBeGreaterThanOrEqual(0);
      }
      expect(d.cacheAnchor).toBeGreaterThanOrEqual(0);
      expect(d.outsideAnchor).toBeGreaterThanOrEqual(0);
      // Вход смотрит на «свою» сторону: от КПП, у самого фронта — в пределах его пустоши.
      expect(Math.hypot(d.x - d.front.exit.x, d.y - d.front.exit.y)).toBeLessThan(400);
      expect(d.broken).toBe(false);
    }
    D.ruin(D.list[0]);
    expect(D.list[0].broken).toBe(true);
    expect(D.list[1].broken).toBe(false);
  });
});

describe('блиндаж: подвоз', () => {
  test('запас ниже low — подносчик с ящиком идёт из лагеря, дошёл — запас растёт', { timeout: 240_000 }, () => {
    // Первый подносчик по умолчанию выходит не сразу (supply.first: в первые минуты на тропе и у ворот и без того людно), а
    // дорога по ходу сообщения под прицелом — не короткая: время ожидания — первый выход плюс дорога. «Классика»: на
    // «Ничейной полосе» подход к блиндажу пересекает полосу огня постов через ворота, и подносчики там гибнут (см. тест ниже).
    // Оба КПП — у западной стены и подход к обоим блиндажам похож (тропа от лагеря в предгорьях → проход в пустошь КПП → траншея
    // к входу), и подносчика на нём может подстрелить пост через ворота: тогда следующего шлют не раньше lossBackoff с (см. тест
    // ниже) — это не поломка подвоза. Поэтому блиндажи пусты оба, а проверяем тот, куда ящик дошёл первым (без привязки к «Северу»).
    const S = WAR.dugout.supply;
    const sim = front('classic');
    const D = sim.war.dugouts;
    for (const x of D.list) {
      x.kits = 0;
      x.grenades = 0;
    }
    // По каждому блиндажу: подносчик с ящиком в руках и как близко он подошёл к ящику блиндажа.
    const track = D.list.map(() => ({ carried: null as Character | null, near: Infinity }));
    // Крутим до первой сдачи ящика: дальше запас расходуют бойцы линии и выходит следующий подносчик.
    until(
      sim,
      () => {
        D.list.forEach((x, k) => {
          if (x.porter?.carrying) track[k].carried = x.porter;
          const t = track[k];
          if (t.carried) t.near = Math.min(t.near, Math.hypot(t.carried.x - x.cache.x, t.carried.y - x.cache.y));
        });
        return D.stats.supplied >= 1 && D.list.some((x) => x.kits > 0);
      },
      S.first + 200,
    );
    const k = D.list.findIndex((x) => x.kits > 0);
    expect(k, 'ящик дошёл хотя бы до одного блиндажа').toBeGreaterThanOrEqual(0);
    const d = D.list[k];
    const { carried, near } = track[k];
    expect(carried, 'подносчик с ящиком').not.toBeNull();
    expect(brain(carried!).supplyTask).toBe('deliver');
    expect(D.stats.supplied).toBeGreaterThanOrEqual(1);
    expect(d.kits).toBeGreaterThanOrEqual(WAR.dugout.supply.perCrate.kits);
    expect(d.grenades).toBeGreaterThanOrEqual(WAR.dugout.supply.perCrate.grenades);
    // До ящика подносчик дошёл вплотную; ящик сдан — руки пусты, сам идёт назад.
    expect(near).toBeLessThanOrEqual(WAR.dugout.supply.reach + 4);
    expect(carried!.carrying).toBe(false);
    // Подносчик — не штурмующий: в отряд фронта не входит.
    for (const f of sim.war.fronts) for (const c of f.squad) expect(brain(c).onService).toBe(false);
  });

  test('подносчик погиб — ящик пропал, запас не вырос; следующий — не сразу (подход простреливается), потом выходит', { timeout: 240_000 }, () => {
    const S = WAR.dugout.supply;
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    d.kits = 0;
    d.grenades = 0;
    expect(until(sim, () => !!d.porter, S.first + 30), 'первый подносчик вышел').toBeGreaterThan(0);
    // Не раньше supply.first с от начала: раньше тропа и ворота заняты армией, ящик уйдёт под огонь.
    expect(D.now).toBeGreaterThanOrEqual(S.first - 1);
    const first = d.porter;
    expect(first).not.toBeNull();
    expect(first!.carrying).toBe(true);
    sim.combat.kill(first!, null, 'тест');
    run(sim, 1);
    expect(d.porter).toBeNull();
    expect(first!.carrying).toBe(false);
    expect(d.kits).toBe(0);
    expect(D.stats.supplied).toBe(0);
    // Потерян подносчик — следующего шлют не раньше чем через lossBackoff с (за каждую потерю подряд, до lossStreak).
    expect(d.lost).toBe(1);
    expect(D.stats.crewLost).toBeGreaterThanOrEqual(1);
    run(sim, S.lossBackoff - 20);
    expect(d.porter, 'пока подход простреливается — никого').toBeNull();
    expect(until(sim, () => !!d.porter, S.every + 40), 'следующий вышел').toBeGreaterThan(0);
    expect(d.porter).not.toBe(first);
  });

  test('запас полон — подносчиков нет', { timeout: 120_000 }, () => {
    const sim = front();
    const D = sim.war.dugouts;
    for (const d of D.list) {
      d.kits = WAR.dugout.stock.kits.cap;
      d.grenades = WAR.dugout.stock.grenades.cap;
    }
    run(sim, 120);
    expect(D.stats.supplied).toBe(0);
    for (const d of D.list) expect(d.porter).toBeNull();
  });
});

describe('блиндаж: пользование линией', () => {
  test('боец линии с пустыми магазинами пополняется в блиндаже, а не идёт в лагерь', { timeout: 240_000 }, () => {
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    // Под огнём всякое бывает: убили по дороге — пробуем со следующим бойцом (до трёх попыток).
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      expect(until(sim, () => !!seatedHolder(sim), 150), 'боец на позиции').toBeGreaterThan(0);
      const holder = seatedHolder(sim)!;
      // Весь запас патронов — вон (в стволе остаётся магазин, этого мало: WAR.line.minMags).
      for (const a of ammoItems(holder)) holder.inventory.remove(a.id, a.qty);
      const before = D.stats.restocked;
      let wasBunker = false;
      let fled = false;
      let restockedIn = false;
      run(sim, 40, () => {
        const m = brain(holder).mode;
        if (m === 'bunker') wasBunker = true;
        if (m === 'retreat' || m === 'camp') fled = true;
        if (wasBunker && inRoom(sim, holder, 1) && D.ammoShort(holder) < 1) restockedIn = true;
      });
      if (!holder.alive || holder.downed || fled) {
        // Тяжело ранило по дороге (тогда в лагерь — по правилам) или убило — другая попытка.
        expect(wasBunker, 'пошёл в блиндаж').toBe(true);
        continue;
      }
      expect(wasBunker, 'пошёл в блиндаж').toBe(true);
      expect(restockedIn, 'патроны взял у ящика внутри').toBe(true);
      expect(D.stats.restocked).toBeGreaterThan(before);
      expect(ammoItems(holder).length).toBeGreaterThan(0);
      expect(['bunker', 'line']).toContain(brain(holder).mode);
      done = true;
    }
    expect(done, 'хоть один боец дошёл до ящика живым').toBe(true);
    expect(d.owner).toBe('rebels');
  });

  test('запаса нет — за патронами в блиндаж не идёт: прежний путь в лагерь', { timeout: 180_000 }, () => {
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    d.kits = 0;
    d.grenades = 0;
    // Подвоз не мешает: подносчиков не шлём.
    d.nextSupply = Infinity;
    expect(until(sim, () => !!seatedHolder(sim), 150), 'боец на позиции').toBeGreaterThan(0);
    const holder = seatedHolder(sim);
    for (const a of ammoItems(holder!)) holder!.inventory.remove(a.id, a.qty);
    let retreated = false;
    run(sim, 20, () => {
      if (brain(holder!).mode === 'retreat') retreated = true;
    });
    expect(retreated).toBe(true);
    expect(D.stats.restocked).toBe(0);
  });

  test('резерв линии сидит в блиндаже (у коек), его берут на смену; сменённый отдыхает там и лечится до rest.cap', { timeout: 240_000 }, () => {
    Object.assign(WAR.line, { shift: 60, relief: 20 });
    // Резерв пополняют из лагеря не сразу (reserveFrom — в первые минуты все идут на линию), сам порядок смены — предмет теста.
    Object.assign(WAR.dugout, { reserveFrom: 0 });
    const sim = front();
    // Тест — про порядок резерва и отдыха в блиндаже, не про огонь гарнизона: подход к блиндажу простреливается, и на
    // части раскладок мира резерв выкашивает по дороге. Протекторат (часовые и Легион) — без оружия.
    for (const c of sim.entities.list) {
      if (!(c.brain instanceof CpBrain || c.brain instanceof OtaBrain)) continue;
      c.inventory.clear();
      c.weapon = null;
    }
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    const cmd = sim.war.command;
    const f0 = sim.war.fronts[0];
    const waiting = () => cmd.bunkerOf(f0).filter((c) => brain(c).bunkerTask === 'ready' && inRoom(sim, c, 1));
    expect(until(sim, () => waiting().length >= WAR.dugout.reserve && cmd.lineOf(f0).length >= 1, 150), 'резерв дошёл до блиндажа').toBeGreaterThan(0);
    // Резерв: боец «ready» в блиндаже у койки.
    const reserve = waiting();
    expect(reserve.length).toBeGreaterThanOrEqual(WAR.dugout.reserve);
    for (const c of reserve) expect(inRoom(sim, c, 1)).toBe(true);
    expect(d.bunks.some((k) => k.user && reserve.includes(k.user))).toBe(true);
    const reserveIds = reserve.map((c) => c.id);
    let promoted = false;
    let rested = false;
    let fled = false;
    let hpIn = 0;
    let hpMax = 0;
    let old: Character | undefined;
    // Смену отстоит боец, которого ранило: после смены он не в лагерь, а на койку. Убили по дороге — берём следующего.
    // Подход к блиндажу простреливается (см. «Линия фронта»): попыток с запасом, нового бойца на линии ждём дольше.
    for (let attempt = 0; attempt < 6 && !rested; attempt++) {
      old = cmd.lineOf(f0).find((c) => c.fit && !c.downed && brain(c).lineHere);
      if (!old) {
        run(sim, 30);
        continue;
      }
      old.health = old.maxHealth * 0.5;
      // Смена у него кончается сейчас (всё равно под огнём ненадёжно ждать целую смену).
      brain(old).lineSince = cmd.now - WAR.line.shift;
      hpIn = old.health;
      hpMax = old.health;
      fled = false;
      const who = old;
      run(sim, 70, () => {
        const b = brain(who);
        if (b.mode === 'retreat' || b.mode === 'camp') fled = true;
        if (b.mode === 'bunker' && b.bunkerTask === 'rest' && inRoom(sim, who, 1)) {
          if (!rested) hpIn = who.health;
          rested = true;
          hpMax = Math.max(hpMax, who.health);
        }
        if (cmd.lineOf(f0).some((c) => reserveIds.includes(c.id))) promoted = true;
      });
    }
    expect(promoted, 'резерв встал на линию').toBe(true);
    expect(rested, 'сменённый отдыхал на койке').toBe(true);
    expect(fled, 'в лагерь не ходил').toBe(false);
    // Отдых лечит, но не выше rest.cap максимума (полное лечение — только в лагере).
    expect(hpMax).toBeGreaterThan(hpIn + 3);
    expect(hpMax).toBeLessThanOrEqual(old!.maxHealth * WAR.dugout.rest.cap + 1);
    expect(D.stats.rests).toBeGreaterThanOrEqual(1);
    // Блиндаж принимает не больше, чем вмещает.
    expect(D.garrison(d)).toBeLessThanOrEqual(d.bunks.length + 1);
  });

  test('резерв пополняют из лагеря не с первой секунды (reserveFrom), а потом — да', { timeout: 120_000 }, () => {
    Object.assign(WAR.dugout, { reserveFrom: 20 });
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    run(sim, 15);
    expect(D.garrison(d)).toBe(0);
    expect(D.needsReserve(d), 'рано: все идут на линию').toBe(false);
    // Пора: штаб высылает резерв из лагеря (в блиндаж идёт боец), и не раньше reserveFrom.
    expect(until(sim, () => D.garrison(d) >= 1, 40), 'резерв выслан').toBeGreaterThan(0);
    expect(D.now).toBeGreaterThanOrEqual(WAR.dugout.reserveFrom);
  });

  test('тяжело раненый — в лагерь, а не на койку', { timeout: 180_000 }, () => {
    const sim = front();
    const D = sim.war.dugouts;
    expect(until(sim, () => !!seatedHolder(sim), 150), 'боец на позиции').toBeGreaterThan(0);
    const holder = seatedHolder(sim);
    holder!.health = holder!.maxHealth * (WAR.dugout.rest.severe - 0.1);
    expect(D.admit(holder!, brain(holder!), 'hurt')).toBeNull();
    // Здоровый после смены — на койку (или за патронами).
    holder!.health = holder!.maxHealth;
    expect(D.admit(holder!, brain(holder!), 'shift')).not.toBeNull();
    // Долго вне лагеря — в лагерь на ротацию.
    brain(holder!).outSince = sim.war.command.now - WAR.dugout.rotateCamp - 1;
    expect(D.admit(holder!, brain(holder!), 'shift')).toBeNull();
  });
});

describe('блиндаж: вылазка Протектората, разрушение и отстройка', () => {
  test('в пустом блиндаже легионеры закладывают заряд — блиндаж разрушен, запас пропал; своих внутри нет — вылазка идёт', { timeout: 240_000 }, () => {
    Object.assign(WAR.dugout.sortie, { chance: 1, firstAfter: 0, every: 20 });
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    sim.war.command.paused = true;
    // Армии нет (и не возрождается): легионеры идут к блиндажу мимо лагеря, и исход вылазки решала стычка с ним —
    // от случая к случаю 3 или 20 попыток, а проверяем закладку заряда, а не бой с лагерем.
    sim.roster.paused = true;
    for (const c of sim.war.command.army) if (c.alive) sim.combat.kill(c, null, 'тест');
    run(sim, 2);
    d.nextSortie = 0;
    expect(D.defenders(d)).toBe(0);
    let raiders = 0;
    let planted = false;
    until(sim, () => {
      raiders = Math.max(raiders, d.raiders.length);
      if (d.charge > 0) planted = true;
      return d.owner === 'ruined';
    }, 500);
    expect(D.stats.sorties).toBeGreaterThanOrEqual(1);
    expect(raiders).toBeGreaterThanOrEqual(1);
    expect(planted, 'заряд копился у входа').toBe(true);
    expect(d.owner).toBe('ruined');
    expect(D.stats.ruined).toBeGreaterThanOrEqual(1);
    expect(d.kits).toBe(0);
    expect(d.grenades).toBe(0);
    expect(sim.log.some((l) => l.includes('блиндаж противника') && l.includes('уничтожен'))).toBe(true);
    // Вылазка кончилась: легионеры не остаются в режиме вылазки.
    run(sim, 5);
    expect(sim.war.ota.filter((o) => o.alive && o.brain instanceof OtaBrain && o.brain.mode === 'sortie')).toHaveLength(0);
  });

  test('повстанец внутри (или рядом) — вылазки нет', { timeout: 120_000 }, () => {
    Object.assign(WAR.dugout.sortie, { chance: 1, firstAfter: 0, every: 10 });
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    sim.war.command.paused = true;
    // Свой — внутри с самого начала (вылазка проверяет блиндаж с первого же тика).
    const guard = createCharacter(sim.entities, sim.ctx.rng, 'rebel', d.x, d.y, false, 0);
    expect(D.defenders(d)).toBeGreaterThanOrEqual(WAR.dugout.sortie.minDefenders);
    d.nextSortie = 0;
    run(sim, 90);
    // Против этого блиндажа вылазок нет (у второго КПП, пустого, они идут — это его дело).
    expect(d.sorties).toBe(0);
    expect(d.owner).toBe('rebels');
    // Защитник ушёл — вылазка начинается.
    sim.combat.kill(guard, null, 'тест');
    d.nextSortie = 0;
    run(sim, 30);
    expect(d.sorties).toBeGreaterThanOrEqual(1);
  });

  test('защитники у входа сбивают закладку: пока рядом повстанец, заряд не растёт', { timeout: 120_000 }, () => {
    Object.assign(WAR.dugout.sortie, { chance: 1, firstAfter: 0, every: 10 });
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    sim.war.command.paused = true;
    // Армии нет — как в тесте выше: иначе легионеры по дороге мимо лагеря ввязываются в бой с ним.
    sim.roster.paused = true;
    for (const c of sim.war.command.army) if (c.alive) sim.combat.kill(c, null, 'тест');
    run(sim, 2);
    d.nextSortie = 0;
    // Ждём, пока легионеры начнут закладку; тогда рядом оказывается повстанец.
    expect(until(sim, () => d.charge > 1, 150), 'легионеры дошли до входа').toBeGreaterThan(0);
    const sneak = createCharacter(sim.entities, sim.ctx.rng, 'rebel', d.outside.x + 30, d.outside.y, false, 0);
    const at = d.charge;
    let peak = at;
    let guarded = 0;
    run(sim, 6, () => {
      if (sneak.alive && d.raiders.length) {
        guarded++;
        peak = Math.max(peak, d.charge);
      }
    });
    expect(guarded).toBeGreaterThan(0);
    // Пока он жив, прогресс только убывает.
    expect(peak).toBeLessThanOrEqual(at + 0.05);
  });

  test('разрушенный: линия и резерв ходят как раньше — в лагерь; отстройка: прошло ruined с — строитель из лагеря стоит в блиндаже и восстанавливает', { timeout: 240_000 }, () => {
    Object.assign(WAR.dugout.rebuild, { time: 4 });
    Object.assign(WAR.dugout.sortie, { chance: 0 });
    Object.assign(WAR.dugout, { reserveFrom: 0 });
    // «Классика», а не «Ничейная полоса»: там подход к блиндажу пересекает полосу огня постов через ворота (см. тест подвоза), и
    // строителя по дороге из лагеря может убить пост — тогда отстройка откладывается на lossBackoff с, а проверяется здесь она.
    // И на «Классике» пост может подстрелить строителя: следующий — почти сразу (отступ после потерь — свой тест выше).
    Object.assign(WAR.dugout.supply, { lossBackoff: 5 });
    const sim = front('classic');
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    const cmd = sim.war.command;
    const f0 = sim.war.fronts[0];
    run(sim, 40);
    // Резервист мог только что уйти на место погибшего бойца линии — замена из лагеря в пути: ждём её.
    expect(until(sim, () => cmd.bunkerOf(f0).length >= 1, 40)).toBeGreaterThanOrEqual(0);
    D.ruin(d);
    run(sim, 2);
    expect(d.owner).toBe('ruined');
    // Резерв из блиндажа ушёл в лагерь; пока разрушен — никто не заходит.
    expect(cmd.bunkerOf(f0)).toHaveLength(0);
    // Линия работает без блиндажа: бойцы на позициях или идут туда.
    run(sim, 40);
    expect(cmd.lineOf(f0).length).toBeGreaterThanOrEqual(1);
    expect(cmd.bunkerOf(f0)).toHaveLength(0);
    // Подносчик к разрушенному не идёт, пока не отстроят.
    expect(d.porter === null || brain(d.porter).supplyTask === 'build').toBe(true);
    d.ruinedUntil = D.now + 3;
    let builder: Character | null = null;
    run(sim, 150, () => {
      if (d.porter && brain(d.porter).supplyTask === 'build') builder = d.porter;
    });
    expect(builder, 'строитель').not.toBeNull();
    expect(D.stats.builders).toBeGreaterThanOrEqual(1);
    expect(d.owner).toBe('rebels');
    expect(D.stats.rebuilt).toBe(1);
    // Отстроен с пустым запасом.
    expect(d.kits + d.grenades).toBeLessThanOrEqual(WAR.dugout.supply.perCrate.kits + WAR.dugout.supply.perCrate.grenades);
  });
});

describe('блиндаж: сбор перед наступлением и игрок', () => {
  test('сбор перед наступлением — вокруг целого блиндажа (не в самом блиндаже)', { timeout: 240_000 }, () => {
    const sim = front();
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    sim.war.command.launchOffensive(0);
    let near = 0;
    let total = 0;
    run(sim, 150, () => {
      for (const c of sim.war.command.army) {
        const b = c.brain;
        if (!c.alive || !(b instanceof RebelBrain) || b.mode !== 'gather' || b.front !== 0 || b.goalAnchor < 0) continue;
        total++;
        if (Math.hypot(sim.nav.worldX(b.goalAnchor) - d.x, sim.nav.worldY(b.goalAnchor) - d.y) <= WAR.dugout.gather.radius) near++;
      }
    });
    expect(total).toBeGreaterThan(0);
    // Хотя бы у заметной доли целей сбора — окрестности блиндажа (остальные — по прежним правилам).
    expect(near / total).toBeGreaterThan(0.25);
    for (const c of sim.war.command.army) if (c.alive && brain(c).mode === 'gather') expect(sim.map.tileAt(Math.floor(c.x / 16), Math.floor(c.y / 16))).not.toBe(T.DUGOUT_WALL);
  });

  test('игрок-повстанец: E у ящика пополняет патроны и гранаты из запаса; разрушен — нельзя; чужому — нет', { timeout: 120_000 }, () => {
    const sim = front('trenches', false);
    const D = sim.war.dugouts;
    const d = D.of(0)!;
    const p = createCharacter(sim.entities, sim.ctx.rng, 'rebel', d.cache.x, d.cache.y, true, 0);
    p.inventory.add('ak74', 1);
    for (const a of ammoItems(p)) p.inventory.remove(a.id, a.qty);
    const kits = d.kits;
    const msg = D.playerUse(p);
    expect(msg).toContain('Блиндаж');
    expect(ammoItems(p).length).toBeGreaterThan(0);
    expect(d.kits).toBe(kits - 1);
    // Далеко от ящика — ничего.
    p.x += 300;
    expect(D.playerUse(p)).toBeNull();
    p.x -= 300;
    // Пусто — честное сообщение, запас не уходит в минус.
    d.kits = 0;
    for (const a of ammoItems(p)) p.inventory.remove(a.id, a.qty);
    expect(D.playerUse(p)).toContain('запас кончился');
    expect(d.kits).toBe(0);
    // Разрушен.
    D.ruin(d);
    expect(D.playerUse(p)).toContain('разрушен');
    // Гражданину ящик не отдают.
    const citizen = createCharacter(sim.entities, sim.ctx.rng, 'citizen', d.cache.x, d.cache.y, true, 0);
    expect(D.playerUse(citizen)).toContain('не положено');
  });
});
