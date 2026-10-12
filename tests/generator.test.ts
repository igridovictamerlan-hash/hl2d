import { describe, expect, test } from 'vitest';
import { generateCity, validateMap } from '../src/world/generator/CityGenerator';
import { analyzeMap, hatchLinks } from '../src/world/mapStats';
import { NEXUS_TEMPLATE, rotateTemplate } from '../src/world/generator/templates';
import { GENERATOR } from '../src/config/generator';
import { WORLD } from '../src/config/world';
import { ZONE_NAMES } from '../src/config/names';
import { CHECKPOINTS } from '../src/world/generator/checkpoints';
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

  test('шаблон Управы прямоугольный', () => {
    const w = NEXUS_TEMPLATE[0].length;
    for (const row of NEXUS_TEMPLATE) expect(row.length).toBe(w);
    expect(rotateTemplate(NEXUS_TEMPLATE, 180)[0]).toBe([...NEXUS_TEMPLATE[NEXUS_TEMPLATE.length - 1]].reverse().join(''));
  });

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      test('город 340×230 тайлов (~5400×3700 px) в пустоши (западные предгорья, скалы по краям), справа — канализация; стена по краю', () => {
        const map = get(seed);
        const city = map.levelBounds('city');
        const ts = map.tileSize;
        const W = GENERATOR.wastes;
        // Город 340×230 тайлов (5440×3680 px); с запада — предгорья (оба КПП западные), с остальных сторон — скальная кромка.
        expect(WORLD.widthTiles * ts).toBeGreaterThanOrEqual(5300);
        expect(WORLD.widthTiles * ts).toBeLessThanOrEqual(5600);
        expect(WORLD.heightTiles * ts).toBeGreaterThanOrEqual(3600);
        expect(WORLD.heightTiles * ts).toBeLessThanOrEqual(3800);
        // Поверхность = пустошь + город + пустошь; уровень «город» заканчивается зазором перед канализацией.
        expect(city.w).toBe((W.west + WORLD.widthTiles + W.east + WORLD.underground.gap) * ts);
        expect(map.worldHeight).toBe((W.top + WORLD.heightTiles + W.bottom) * ts);
        expect(city.w).toBeGreaterThanOrEqual(6000);
        expect(city.w).toBeLessThanOrEqual(6400);
        expect(map.worldHeight).toBeGreaterThanOrEqual(3600);
        expect(map.worldHeight).toBeLessThanOrEqual(3900);
        // Лагерь сопротивления в пустоши и ровно два люка — в запретной зоне.
        expect(map.poisOf('rebel_camp')).toHaveLength(1);
        expect(map.hatches).toHaveLength(2);
        for (const h of map.hatches) expect(map.zoneAtWorld(h.city.x, h.city.y)?.kind).toBe('restricted');
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
        // Улицы-артерии, общежития, сады особняков, широкий проспект и комнаты домов вдоль него —
        // открытое пространство.
        expect(s.buildingRatio).toBeGreaterThanOrEqual(0.5);
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
        expect(map.poisOf('checkpoint_post').length).toBe(10);
        expect(map.poisOf('gate_post').length).toBe(4);
        expect(map.poisOf('outlands_exit').length).toBe(2);
        // У КПП по 5 зон: D-дворы, шорт, лонг и проходная.
        expect(map.zones.filter((z) => z.kind === 'checkpoint')).toHaveLength(10);
      });

      test('открытые пространства ≤ 300×300 px: площадь и двор Управы', () => {
        const map = get(seed);
        const maxTiles = Math.floor(300 / map.tileSize);
        for (const kind of ['plaza', 'nexus'] as ZoneKind[]) {
          const b = bbox(map, T.PLAZA, kind);
          expect(b.w).toBeLessThanOrEqual(maxTiles);
          expect(b.h).toBeLessThanOrEqual(maxTiles);
        }
      });

      test('есть узкие проходы (только один персонаж), переулки, дворы, арки, жилые дома', () => {
        const map = get(seed);
        const nav = new NavGrid(map);
        const narrow = nav.walkable.filter((i) => nav.cost[i] > 1).length;
        expect(narrow).toBeGreaterThan(200);
        const s = map.stats!;
        expect(s.courtyards).toBeGreaterThanOrEqual(8);
        // Подъезды-коридоры заменены домиками: жилые дома с комнатой и дверью на переулок.
        expect(s.arches).toBeGreaterThanOrEqual(3);
        expect(map.poisOf('home').length).toBeGreaterThan(30);
        expect(s.deadEnds).toBeGreaterThan(15);
        let doors = 0;
        for (const t of map.tiles) if (t === T.DOOR) doors++;
        expect(doors).toBeGreaterThan(10);
      });

      test('два проспекта шириной ≥ 100 px идут от проходных КПП «Север» и «Юг» через весь город на восток', () => {
        const map = get(seed);
        const w = map.width;
        const ts = map.tileSize;
        // Город в полной карте сдвинут на ширину западных предгорий; проспекты кончаются у восточной стены.
        const xEnd = GENERATOR.wastes.west + WORLD.widthTiles - GENERATOR.border - 1;
        const cps = map.poisOf('checkpoint_type').sort((a, b) => a.y - b.y);
        expect(cps).toHaveLength(2);
        // Горизонтальные проспекты — зоны ZONE_NAMES.avenue[0] (главный) и [2] (второй), вертикальный — [1].
        const stats = (name: string) => {
          const zone = map.zones.find((z) => z.kind === 'avenue' && z.name === name)!;
          expect(zone, name).toBeDefined();
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sumY = 0, n = 0, widest = 0;
          for (let x = 0; x < w; x++) {
            let run = 0;
            for (let y = 0; y < map.height; y++) {
              const i = y * w + x;
              if (map.zoneGrid[i] !== zone.id || map.tiles[i] !== T.STREET) { run = 0; continue; }
              x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
              sumY += y; n++;
              run++;
              widest = Math.max(widest, run);
            }
          }
          return { zone, x0, x1, y0, y1, meanY: sumY / n, widest };
        };
        const horizontal = [stats(ZONE_NAMES.avenue[0]), stats(ZONE_NAMES.avenue[2])].sort((a, b) => a.meanY - b.meanY);
        const vertical = stats(ZONE_NAMES.avenue[1]);
        // Первый проспект (выше) — продолжение КПП «Север», второй — КПП «Юг».
        horizontal.forEach((av, k) => {
          const cp = cps[k];
          const axisY = cp.y + CHECKPOINTS[cp.kind as keyof typeof CHECKPOINTS].axisRow;
          expect(av.widest * ts, `ширина проспекта ${av.zone.name}`).toBeGreaterThanOrEqual(100);
          // Начинается у проходной своего КПП, на его оси, и доходит до восточной стены.
          expect(Math.abs(av.x0 - (cp.x + cp.w!)), `начало проспекта ${av.zone.name} у проходной КПП`).toBeLessThanOrEqual(2);
          expect(av.y0, `ось КПП в полосе проспекта ${av.zone.name}`).toBeLessThanOrEqual(axisY);
          expect(av.y1, `ось КПП в полосе проспекта ${av.zone.name}`).toBeGreaterThanOrEqual(axisY);
          expect(av.x1, `конец проспекта ${av.zone.name} у восточной стены`).toBe(xEnd);
        });
        // Вертикальный проспект пересекает оба горизонтальных.
        expect(vertical.widest).toBeGreaterThan(30);
        expect(vertical.y0).toBeLessThan(horizontal[0].y0);
        expect(vertical.y1).toBeGreaterThan(horizontal[1].y1);
        // Сплошной проход от лагеря в предгорьях до конца проспектов: в каждом столбце есть асфальт, бетон, тропа или ворота.
        const cityW = map.underground!.x - WORLD.underground.gap;
        const has: boolean[] = [];
        for (let x = 0; x < cityW; x++) {
          let any = false;
          for (let y = 0; y < map.height && !any; y++) {
            const t = map.tiles[y * w + x];
            any = t === T.STREET || t === T.BUNKER || t === T.WASTE || t === T.GATE;
          }
          has.push(any);
        }
        const first = has.indexOf(true);
        const last = has.lastIndexOf(true);
        expect(first, 'проход начинается в предгорьях (лагерь)').toBeLessThan(GENERATOR.wastes.west - GENERATOR.wastes.trail);
        expect(last, 'проход доходит до восточной стены').toBeGreaterThanOrEqual(xEnd);
        const gaps = has.map((h, x) => (!h && x > first && x < last ? x : -1)).filter((x) => x >= 0);
        expect(gaps, 'столбцы без прохода между лагерем и концом проспектов').toEqual([]);
        expect(SOLID[T.STREET]).toBe(0);
      });
    });
  }
});
