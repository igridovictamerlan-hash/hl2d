import type { GameMap } from './GameMap';

/**
 * Луч по сетке тайлов (DDA, Amanatides–Woo): расстояние до первого непрозрачного тайла
 * (стена, закрытая дверь) или maxDist. Стартовый тайл не проверяется.
 */
export function castRay(map: GameMap, ox: number, oy: number, dx: number, dy: number, maxDist: number): number {
  const ts = map.tileSize;
  let tx = Math.floor(ox / ts);
  let ty = Math.floor(oy / ts);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  let tMaxX = adx > 1e-9 ? (dx > 0 ? (tx + 1) * ts - ox : ox - tx * ts) / adx : Infinity;
  let tMaxY = ady > 1e-9 ? (dy > 0 ? (ty + 1) * ts - oy : oy - ty * ts) / ady : Infinity;
  const tDeltaX = adx > 1e-9 ? ts / adx : Infinity;
  const tDeltaY = ady > 1e-9 ? ts / ady : Infinity;
  for (;;) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (t >= maxDist) return maxDist;
    if (map.isOpaque(tx, ty)) return t;
  }
}

/** Видит ли точка A точку B (стены и закрытые двери перекрывают). */
export function lineOfSight(map: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  if (d < 1e-6) return true;
  return castRay(map, ax, ay, (bx - ax) / d, (by - ay) / d, d) >= d - 1e-6;
}

/** Виден ли кружок радиуса r целиком или краем (центр и два боковых края). */
export function canSeeCircle(map: GameMap, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  if (lineOfSight(map, ax, ay, bx, by)) return true;
  const d = Math.hypot(bx - ax, by - ay) || 1;
  const px = (-(by - ay) / d) * r * 0.8;
  const py = ((bx - ax) / d) * r * 0.8;
  return lineOfSight(map, ax, ay, bx + px, by + py) || lineOfSight(map, ax, ay, bx - px, by - py);
}

/** Область видимости: многоугольник из концов лучей (x0, y0, x1, y1, …). */
export class VisibilityPolygon {
  readonly points: Float32Array;
  readonly dirs: Float32Array;

  constructor(readonly rays: number) {
    this.points = new Float32Array(rays * 2);
    this.dirs = new Float32Array(rays * 2);
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2;
      this.dirs[k * 2] = Math.cos(a);
      this.dirs[k * 2 + 1] = Math.sin(a);
    }
  }

  compute(map: GameMap, x: number, y: number, radius: number, bleed: number): void {
    for (let k = 0; k < this.rays; k++) {
      const dx = this.dirs[k * 2];
      const dy = this.dirs[k * 2 + 1];
      const t = castRay(map, x, y, dx, dy, radius);
      const d = t < radius ? t + bleed : radius;
      this.points[k * 2] = x + dx * d;
      this.points[k * 2 + 1] = y + dy * d;
    }
  }
}
