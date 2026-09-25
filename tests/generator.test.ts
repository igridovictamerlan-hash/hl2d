import { describe, expect, test } from 'vitest';
import { generateCity, validateMap } from '../src/world/generator/CityGenerator';
import { analyzeMap, hatchLinks } from '../src/world/mapStats';
import { NEXUS_TEMPLATE, rotateTemplate } from '../src/world/generator/templates';
import { GENERATOR } from '../src/config/generator';
import { T, SOLID } from '../src/world/tiles';
import { NavGrid } from '../src/world/NavGrid';
import type { GameMap, ZoneKind } from '../src/world/GameMap';

const SEEDS = [12345, 7919, 424242, 31337, 2024];
const maps = new Map<number, GameMap>();
const get = (seed: number) => {
  if (!maps.has(seed)) maps.set(seed, generateCity(seed));
  return maps.get(seed)!;
};

/** Ограничивающий прямоугольник тайлов данного типа внутри зоны данного вида. */
function bbox(map: GameMap, tile: number, kind: ZoneKind) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y * map.width + x] !== tile || map.zoneAtTile(x, y)?.kind !== kind) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

describe('генератор переулочного города', () => {
  test('детерминирован по seed', () => {
    const a = generateCity(555);
    const b = generateCity(555);
    expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(true);
    expect(Buffer.from(a.zoneGrid).equals(Buffer.from(b.zoneGrid))).toBe(true);
  });

  test('шаблон Нексуса прямоугольный', () => {
    const w = NEXUS_TEMPLATE[0].length;
    for (const row of NEXUS_TEMPLATE) expect(row.length).toBe(w);
    expect(rotateTemplate(NEXUS_TEMPLATE, 180)[0]).toBe([...NEXUS_TEMPLATE[NEXUS_TEMPLATE.length - 1]].reverse().join(''));
  });

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      test('город ~3000×3000 px, справа — канализация; стена по краю', () => {
        const map = get(seed);
        const city = map.levelBounds('city');
        expect(city.w).toBeGreaterThanOrEqual(2900);
        expect(city.w).toBeLessThanOrEqual(3100);
        expect(map.worldHeight).toBeGreaterThanOrEqual(2900);
        expect(map.worldHeight).toBeLessThanOrEqual(3100);
        const u = map.underground!;
        expect(u.x * map.tileSize).toBeGreaterThanOrEqual(city.w);
        expect(u.w).toBeGreaterThan(60);
        for (let x = 0; x < map.width; x++) {
          expect(map.isSolid(x, 0)).toBe(true);
          expect(map.isSolid(x, map.height - 1)).toBe(true);
        }
      });

      test('связность: одна компонента, нет недостижимых мест', () => {
        // Город и канализация — разные области сетки, связанные люками: вместе — одна компонента.
        const check = analyzeMap(get(seed).tiles, get(seed).width, get(seed).height, hatchLinks(get(seed)));
        expect(check.components).toBe(1);
        expect(check.unreachableTiles).toBe(0);
      });

      test('здания ~70% площади, прямые участки ≤ 400 px', () => {
        const map = get(seed);
        const s = map.stats!;
        expect(validateMap(map)).toEqual([]);
        expect(s.buildingRatio).toBeGreaterThanOrEqual(0.64);
        expect(s.buildingRatio).toBeLessThanOrEqual(0.78);
        expect(s.longestAlleyRun * map.tileSize).toBeLessThanOrEqual(400);
      });

      test('все обязательные районы и точки', () => {
        const map = get(seed);
        const kinds = new Set(map.zones.map((z) => z.kind));
        for (const k of ['residential', 'avenue', 'plaza', 'nexus', 'cells', 'industrial', 'restricted', 'checkpoint', 'outlands'] as ZoneKind[]) {
          expect(kinds.has(k)).toBe(true);
        }
        expect(map.poisOf('cell').length).toBeGreaterThanOrEqual(4);
        expect(map.poisOf('ration_window').length).toBe(1);
        expect(map.poisOf('checkpoint_post').length).toBe(6);
        expect(map.poisOf('outlands_exit').length).toBe(2);
        expect(map.zones.filter((z) => z.kind === 'checkpoint')).toHaveLength(2);
      });

      test('открытые пространства ≤ 300×300 px: площадь и двор Нексуса', () => {
        const map = get(seed);
        const maxTiles = Math.floor(300 / map.tileSize);
        for (const kind of ['plaza', 'nexus'] as ZoneKind[]) {
          const b = bbox(map, T.PLAZA, kind);
          expect(b.w).toBeLessThanOrEqual(maxTiles);
          expect(b.h).toBeLessThanOrEqual(maxTiles);
        }
      });

      test('есть узкие проходы (только один персонаж), переулки, дворы, арки, подъезды', () => {
        const map = get(seed);
        const nav = new NavGrid(map);
        const narrow = nav.walkable.filter((i) => nav.cost[i] > 1).length;
        expect(narrow).toBeGreaterThan(200);
        const s = map.stats!;
        expect(s.courtyards).toBeGreaterThanOrEqual(8);
        expect(s.arches).toBeGreaterThan(5);
        expect(s.passages).toBeGreaterThan(5);
        expect(s.deadEnds).toBeGreaterThan(15);
        let doors = 0;
        for (const t of map.tiles) if (t === T.DOOR) doors++;
        expect(doors).toBeGreaterThan(10);
      });

      test('магистраль шириной 100–140 px пересекает город (концы — коридоры КПП)', () => {
        const map = get(seed);
        // Ищем столбец, где подряд идут 7–8 тайлов асфальта.
        let widest = 0;
        for (let x = 10; x < map.width - 10; x += 7) {
          let run = 0;
          for (let y = 0; y < map.height; y++) {
            run = map.tiles[y * map.width + x] === T.STREET ? run + 1 : 0;
            widest = Math.max(widest, run);
          }
        }
        expect(widest * map.tileSize).toBeGreaterThanOrEqual(100);
        let streetCols = 0;
        const cityW = map.underground!.x - 4;
        for (let x = 0; x < cityW; x++) {
          let has = false;
          for (let y = 0; y < map.height && !has; y++) {
            const t = map.tiles[y * map.width + x];
            has = t === T.STREET || t === T.BUNKER || t === T.WASTE || t === T.GATE;
          }
          if (has) streetCols++;
        }
        expect(streetCols).toBeGreaterThan(cityW - 2 * GENERATOR.border - 2);
        expect(SOLID[T.STREET]).toBe(0);
      });
    });
  }
});
