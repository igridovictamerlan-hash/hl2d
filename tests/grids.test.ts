import { describe, expect, test } from 'vitest';
import { BoxGrid } from '../src/world/BoxGrid';
import { SpatialHash } from '../src/world/SpatialHash';
import { Rng } from '../src/core/rng';

describe('сетки «что рядом»', () => {
  test('BoxGrid: все задевающие окно — по возрастанию, без повторов; далёкие — нет', () => {
    const rng = new Rng(5);
    const boxes = Array.from({ length: 400 }, () => {
      const x = rng.range(0, 4000);
      const y = rng.range(0, 3000);
      return [x, y, x + rng.range(0, 300), y + rng.range(0, 300)] as const;
    });
    const grid = new BoxGrid(256, 4300, 3300, boxes.length, (i) => boxes[i]);
    for (let k = 0; k < 50; k++) {
      const x0 = rng.range(-200, 4000);
      const y0 = rng.range(-200, 3000);
      const x1 = x0 + rng.range(10, 900);
      const y1 = y0 + rng.range(10, 600);
      const got = grid.query(x0, y0, x1, y1);
      // Без повторов и по возрастанию (порядок отрисовки списка).
      for (let i = 1; i < got.length; i++) expect(got[i]).toBeGreaterThan(got[i - 1]);
      const set = new Set(got);
      boxes.forEach((b, i) => {
        const hit = b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1;
        if (hit) expect(set.has(i)).toBe(true);
        // Дальше ячейки от окна — не выдаётся.
        const far = b[0] > x1 + 256 || b[2] < x0 - 256 || b[1] > y1 + 256 || b[3] < y0 - 256;
        if (far) expect(set.has(i)).toBe(false);
      });
    }
  });

  test('SpatialHash.within — те же и в том же порядке, что запрос по ячейкам с отсевом по расстоянию', () => {
    const rng = new Rng(9);
    const hash = new SpatialHash<{ x: number; y: number }>(64);
    const items = Array.from({ length: 700 }, () => ({ x: rng.range(0, 3000), y: rng.range(0, 2000) }));
    for (const it of items) hash.insert(it);
    hash.insert({ x: 1e7, y: 5 });
    for (let k = 0; k < 200; k++) {
      const x = rng.range(-100, 3100);
      const y = rng.range(-100, 2100);
      const r = rng.range(5, 260);
      const old = hash.query(x, y, r).filter((it) => (it.x - x) ** 2 + (it.y - y) ** 2 <= r * r);
      expect(hash.within(x, y, r)).toEqual(old);
    }
    expect(hash.items.length).toBe(701);
  });
});
