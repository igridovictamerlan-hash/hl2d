import { T } from './tiles';
import { hash2 } from '../core/rng';
import { HOUSES } from '../config/generator';

/** Участок-дом: прямоугольник, обрамляющий его тайлы застройки, и их число. */
export interface Lot {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tiles: number;
}

export interface LotMap {
  /** id участка на тайл (-1 — не дом). */
  lot: Int32Array;
  lots: Lot[];
}

/**
 * Нарезка сплошной застройки (WALL) на участки-дома: связные массивы стен делятся рекурсивно
 * (как BSP) на прямоугольники HOUSES.lot, пересечение с массивом — один дом. Детерминированно по
 * seed и тайлам, поэтому генератор (дома с комнатами) и отрисовка (отдельные крыши) получают одну
 * и ту же нарезку, а в JSON карты её хранить не нужно.
 */
export function computeLots(w: number, h: number, tiles: ArrayLike<number>, seed: number): LotMap {
  const lot = new Int32Array(w * h).fill(-1);
  const comp = new Int32Array(w * h).fill(-1);
  const lots: Lot[] = [];
  const stack: number[] = [];
  const L = HOUSES.lot;
  let comps = 0;
  for (let start = 0; start < w * h; start++) {
    if (tiles[start] !== T.WALL || comp[start] >= 0) continue;
    // Связный массив застройки и его рамка.
    const id = comps++;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && tiles[i - 1] === T.WALL && comp[i - 1] < 0) (comp[i - 1] = id), stack.push(i - 1);
      if (x < w - 1 && tiles[i + 1] === T.WALL && comp[i + 1] < 0) (comp[i + 1] = id), stack.push(i + 1);
      if (y > 0 && tiles[i - w] === T.WALL && comp[i - w] < 0) (comp[i - w] = id), stack.push(i - w);
      if (y < h - 1 && tiles[i + w] === T.WALL && comp[i + w] < 0) (comp[i + w] = id), stack.push(i + w);
    }
    const split = (rx: number, ry: number, rw: number, rh: number, depth: number): void => {
      const hv = hash2(rx * 7 + rw, ry * 13 + rh, seed + depth);
      const cutX = rw > L.max || (rw > L.min * 2 && rw >= rh && hv % 3 !== 0 && rw > L.split);
      const cutY = !cutX && (rh > L.max || (rh > L.min * 2 && rh > L.split && hv % 3 !== 0));
      if (cutX) {
        const c = L.min + (hv % Math.max(1, rw - L.min * 2 + 1));
        split(rx, ry, c, rh, depth + 1);
        split(rx + c, ry, rw - c, rh, depth + 1);
        return;
      }
      if (cutY) {
        const c = L.min + ((hv >>> 8) % Math.max(1, rh - L.min * 2 + 1));
        split(rx, ry, rw, c, depth + 1);
        split(rx, ry + c, rw, rh - c, depth + 1);
        return;
      }
      const lotId = lots.length;
      const l: Lot = { id: lotId, x0: w, y0: h, x1: -1, y1: -1, tiles: 0 };
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const i = y * w + x;
          if (comp[i] !== id) continue;
          lot[i] = lotId;
          l.tiles++;
          if (x < l.x0) l.x0 = x;
          if (x > l.x1) l.x1 = x;
          if (y < l.y0) l.y0 = y;
          if (y > l.y1) l.y1 = y;
        }
      }
      if (l.tiles > 0) lots.push(l);
    };
    split(x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0);
  }
  return { lot, lots };
}
