import { T } from './tiles';
import { hash01 } from '../core/rng';
import { RENDER } from '../config/render';
import { GENERATOR } from '../config/generator';

/**
 * Рельеф гор (только картинка): уступ скалы — сколько тайлов до подножия (ближайшей не-скалы, по 8 соседям),
 * плюс плавная волна шума, делённое на шаг террасы RENDER.tiles.ridge.step. 0 — подножие (осыпь у переулка или
 * тропы), дальше — террасы выше и светлее, на гребне — снег. Полосы хребтов (GENERATOR.wastes.top / bottom
 * рядов у края карты) поднимаются к краю, западные предгорья — пологие. 255 — не скала. Детерминирован по тайлам и seed:
 * карта и мини-карта видят одни и те же уступы.
 */
export function rockRelief(tiles: ArrayLike<number>, w: number, h: number, seed: number): Uint8Array {
  const R = RENDER.tiles.ridge;
  const n = w * h;
  const dist = new Uint16Array(n).fill(0xffff);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) {
    if (tiles[i] === T.ROCK) continue;
    dist[i] = 0;
    q[qt++] = i;
  }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w;
    const y = (i - x) / w;
    const d = dist[i] + 1;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        if (dist[j] <= d) continue;
        dist[j] = d;
        q[qt++] = j;
      }
    }
  }
  const out = new Uint8Array(n).fill(255);
  const cell = R.wobbleCell;
  const top = GENERATOR.wastes.top;
  const bottom = GENERATOR.wastes.bottom;
  for (let i = 0; i < n; i++) {
    if (tiles[i] !== T.ROCK) continue;
    const x = i % w;
    const y = (i - x) / w;
    // Две октавы шума: крупные отроги и мелкая неровность уступов.
    const n = valueNoise(x, y, cell, seed) * 0.7 + valueNoise(x, y, cell / 2.5, seed + 1) * 0.3;
    const wob = (n - 0.5) * 2 * R.wobble;
    const d = dist[i] === 0xffff ? R.maxLevel * R.step : dist[i] - 1;
    // Хребты по северу и югу растут к краю карты (ridgeLift на ряд полосы), предгорья запада — пологие холмы
    // (не выше footMax: без снега).
    const ey = y < top ? top - y : y >= h - bottom ? y - (h - bottom) + 1 : 0;
    // У самого подножия — всегда осыпь (уровень 0), выше — уступы по шуму.
    const elev = d === 0 ? 0 : Math.max(0, d + ey * R.ridgeLift + wob);
    let lv = Math.min(ey > 0 ? R.maxLevel : R.footMax, Math.floor(elev / R.step));
    // Снег на гребне — пятнами: где шум ниже snowGap, проступает камень.
    if (lv >= R.snowLevel && valueNoise(x, y, R.snowCell, seed + 2) < R.snowGap) lv = R.snowLevel - 1;
    out[i] = lv;
  }
  return out;
}

const smooth = (f: number) => f * f * (3 - 2 * f);

/** Шум значений в узлах решётки с шагом cell (по x — вдвое чаще: отроги поперёк хребта), между ними — сглаженно. */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const u = (x * 2) / cell;
  const v = y / cell;
  const gx = Math.floor(u);
  const gy = Math.floor(v);
  const fx = smooth(u - gx);
  const fy = smooth(v - gy);
  const a = hash01(gx, gy, seed) * (1 - fx) + hash01(gx + 1, gy, seed) * fx;
  const b = hash01(gx, gy + 1, seed) * (1 - fx) + hash01(gx + 1, gy + 1, seed) * fx;
  return a * (1 - fy) + b * fy;
}
