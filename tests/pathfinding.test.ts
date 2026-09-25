import { describe, expect, test } from 'vitest';
import { generateCity } from '../src/world/generator/CityGenerator';
import { NavGrid } from '../src/world/NavGrid';
import { AStar } from '../src/ai/AStar';
import { PathService } from '../src/ai/PathService';
import { segmentClear } from '../src/world/collision';
import { Rng } from '../src/core/rng';
import { CHARACTER } from '../src/config/entities';

const map = generateCity(12345);
const nav = new NavGrid(map);
const rng = new Rng(1);
/** Якоря города (канализация — отдельная область, пути туда только через люки). */
const city = nav.walkable.filter((i) => nav.level[i] === 0);

describe('A* по якорям 2×2', () => {
  test('находит путь между случайными точками, шаги — соседние проходимые якоря', () => {
    const astar = new AStar(nav);
    for (let k = 0; k < 40; k++) {
      const a = rng.pick(city);
      const b = rng.pick(city);
      const path = astar.find(a, b)!;
      expect(path).not.toBeNull();
      expect(path[0]).toBe(a);
      expect(path[path.length - 1]).toBe(b);
      for (let i = 1; i < path.length; i++) {
        expect(nav.walk[path[i]]).toBe(1);
        expect(Math.abs(nav.ax(path[i]) - nav.ax(path[i - 1]))).toBeLessThanOrEqual(1);
        expect(Math.abs(nav.ay(path[i]) - nav.ay(path[i - 1]))).toBeLessThanOrEqual(1);
      }
    }
  });

  test('сглаженный путь проходим кружком радиуса 12 px', () => {
    const paths = new PathService(map, nav);
    for (let k = 0; k < 30; k++) {
      const a = rng.pick(city);
      const b = rng.pick(city);
      const pts = paths.findNow(nav.worldX(a), nav.worldY(a), b)!;
      expect(pts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < pts.length; i++) {
        expect(segmentClear(map, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, CHARACTER.radius)).toBe(true);
      }
    }
  });

  test('избегает запретных зон, если есть обход', () => {
    const astar = new AStar(nav);
    const restricted = new Set(map.zones.filter((z) => z.kind === 'restricted').map((z) => z.id));
    const outside = city.filter((i) => !restricted.has(nav.zone[i]));
    let through = 0;
    for (let k = 0; k < 30; k++) {
      const path = astar.find(rng.pick(outside), rng.pick(outside), { avoidZones: restricted })!;
      if (path.some((i) => restricted.has(nav.zone[i]))) through++;
    }
    expect(through).toBe(0);
  });
});
