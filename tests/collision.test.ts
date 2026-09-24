import { describe, expect, test } from 'vitest';
import { GameMap } from '../src/world/GameMap';
import { T } from '../src/world/tiles';
import { circleHitsSolid, resolveCircleVsTiles, segmentClear } from '../src/world/collision';

/** Карта 10×10: пол, стена в столбце x=5 (кроме y=4..5 — проход 2 тайла). */
function testMap(): GameMap {
  const w = 10;
  const tiles = new Uint8Array(w * w).fill(T.FLOOR);
  for (let y = 0; y < w; y++) if (y !== 4 && y !== 5) tiles[y * w + 5] = T.WALL;
  return new GameMap(w, w, 16, tiles, new Uint8Array(w * w), [{ id: 0, kind: 'residential', name: 'Тест', char: 'a' }], [], 1, 'test');
}

describe('коллизии круг–тайлы', () => {
  const map = testMap();

  test('выталкивает из стены по нормали', () => {
    const p = { x: 5 * 16 - 6, y: 20 };
    expect(resolveCircleVsTiles(map, p, 12)).toBe(true);
    expect(p.x).toBeCloseTo(5 * 16 - 12, 5);
    expect(circleHitsSolid(map, p.x, p.y, 11.9)).toBe(false);
  });

  test('за пределами карты — стена', () => {
    const p = { x: 4, y: 40 };
    resolveCircleVsTiles(map, p, 12);
    expect(p.x).toBeGreaterThanOrEqual(12 - 1e-6);
  });

  test('в проход 32 px кружок диаметром 24 px пролезает, а сквозь стену — нет', () => {
    expect(segmentClear(map, 40, 80, 120, 80, 12)).toBe(true);
    expect(segmentClear(map, 40, 30, 120, 30, 12)).toBe(false);
  });
});
