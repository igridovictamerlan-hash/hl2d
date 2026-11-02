import { describe, expect, test } from 'vitest';
import { generateCity } from '../src/world/generator/CityGenerator';
import { NavGrid } from '../src/world/NavGrid';
import { AStar } from '../src/ai/AStar';
import { PathService } from '../src/ai/PathService';
import { segmentClear } from '../src/world/collision';
import { Rng } from '../src/core/rng';
import { CHARACTER } from '../src/config/entities';
import { AI } from '../src/config/ai';

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

  test('карман цели: цель за кольцом закрытого — отказ сразу; найденные пути те же, что без проверки', () => {
    const astar = new AStar(nav);
    const w = nav.w;
    // Закрытые «дома» — квадраты вокруг случайных якорей (снаружи в них не входят, изнутри выходят).
    const boxes = Array.from({ length: 60 }, () => {
      const c = rng.pick(city);
      return { x: c % w, y: Math.floor(c / w), r: 3 + rng.int(0, 5) };
    });
    const inBox = (n: number) => {
      const x = n % w;
      const y = (n - x) / w;
      return boxes.some((b) => Math.abs(x - b.x) <= b.r && Math.abs(y - b.y) <= b.r);
    };
    // Кольцо закрытого вокруг цели: сама цель и её окрестность открыты, но снаружи туда не попасть.
    const goal = city.find((i) => nav.level[i] === 0 && Math.abs((i % w) - 300) < 2 && Math.abs(Math.floor(i / w) - 150) < 40)!;
    const gx = goal % w;
    const gy = Math.floor(goal / w);
    const ring = (n: number) => {
      const d = Math.max(Math.abs((n % w) - gx), Math.abs(Math.floor(n / w) - gy));
      return d >= 6 && d <= 7;
    };
    const far = city.find((i) => Math.abs((i % w) - gx) > 80)!;
    expect(astar.find(far, goal, { blocked: ring })).toBeNull();
    expect(astar.lastExpanded).toBeLessThanOrEqual(AI.pathPocketAfter);
    // Двор открыт, но заперт кольцом: изнутри тоже не выйти. Закрыт весь круг (как дом) — изнутри выходят.
    expect(astar.find(goal, far, { blocked: ring })).toBeNull();
    const house = (n: number) => Math.max(Math.abs((n % w) - gx), Math.abs(Math.floor(n / w) - gy)) <= 7;
    expect(astar.find(goal, far, { blocked: house })).not.toBeNull();
    // Те же поиски без проверки кармана — те же ответы.
    const pairs = Array.from({ length: 40 }, () => [rng.pick(city), rng.pick(city)] as const);
    const withPocket = pairs.map(([a, b]) => astar.find(a, b, { blocked: inBox }));
    const cfg = AI as { pathPocketAfter: number };
    const keep = cfg.pathPocketAfter;
    cfg.pathPocketAfter = Number.MAX_SAFE_INTEGER;
    try {
      const plain = pairs.map(([a, b]) => astar.find(a, b, { blocked: inBox }));
      expect(withPocket).toEqual(plain);
      expect(plain.some((p) => p === null)).toBe(true);
      expect(plain.some((p) => p !== null)).toBe(true);
    } finally {
      cfg.pathPocketAfter = keep;
    }
  });
});
