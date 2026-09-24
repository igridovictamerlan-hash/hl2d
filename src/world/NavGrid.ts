import type { GameMap } from './GameMap';
import { buildAnchorWalk } from './connectivity';
import { AI } from '../config/ai';

/**
 * Навигационная сетка «якорей» 2×2 тайла. Якорь (ax, ay) — это позиция центра персонажа
 * в точке ((ax+1)·16, (ay+1)·16): круг радиусом 12 целиком помещается в квадрат 32×32.
 * Проходы шириной 2 тайла дают ровно одну «полосу» якорей, 3 тайла — две.
 */
export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly ts: number;
  readonly walk: Uint8Array;
  /** Множитель стоимости: в узких проходах (без бокового манёвра) дороже. */
  readonly cost: Float32Array;
  /** Зона тайла под центром якоря. */
  readonly zone: Uint8Array;
  /** Проходимые якоря по зонам — для выбора целей прогулки. */
  readonly anchorsByZone = new Map<number, number[]>();
  readonly walkable: number[] = [];

  constructor(readonly map: GameMap) {
    this.w = map.width - 1;
    this.h = map.height - 1;
    this.ts = map.tileSize;
    this.walk = buildAnchorWalk(map.tiles, map.width, map.height);
    this.cost = new Float32Array(this.w * this.h).fill(1);
    this.zone = new Uint8Array(this.w * this.h);
    for (let ay = 0; ay < this.h; ay++) {
      for (let ax = 0; ax < this.w; ax++) {
        const i = ay * this.w + ax;
        this.zone[i] = map.zoneGrid[(ay + 1) * map.width + ax + 1];
        if (!this.walk[i]) continue;
        this.walkable.push(i);
        let list = this.anchorsByZone.get(this.zone[i]);
        if (!list) this.anchorsByZone.set(this.zone[i], (list = []));
        list.push(i);
        const lr = !this.isWalkable(ax - 1, ay) && !this.isWalkable(ax + 1, ay);
        const ud = !this.isWalkable(ax, ay - 1) && !this.isWalkable(ax, ay + 1);
        if (lr || ud) this.cost[i] = AI.narrowCost;
      }
    }
  }

  isWalkable(ax: number, ay: number): boolean {
    return ax >= 0 && ay >= 0 && ax < this.w && ay < this.h && this.walk[ay * this.w + ax] === 1;
  }

  ax(i: number): number {
    return i % this.w;
  }

  ay(i: number): number {
    return (i - (i % this.w)) / this.w;
  }

  worldX(i: number): number {
    return ((i % this.w) + 1) * this.ts;
  }

  worldY(i: number): number {
    return (Math.floor(i / this.w) + 1) * this.ts;
  }

  /** Ближайший проходимый якорь к точке мира (в радиусе maxR якорей), -1 — нет. */
  nearestWalkable(x: number, y: number, maxR = 4): number {
    const cx = Math.round(x / this.ts) - 1;
    const cy = Math.round(y / this.ts) - 1;
    let best = -1;
    let bestD = Infinity;
    for (let dy = -maxR; dy <= maxR; dy++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        const ax = cx + dx;
        const ay = cy + dy;
        if (!this.isWalkable(ax, ay)) continue;
        const wx = (ax + 1) * this.ts - x;
        const wy = (ay + 1) * this.ts - y;
        const d = wx * wx + wy * wy;
        if (d < bestD) {
          bestD = d;
          best = ay * this.w + ax;
        }
      }
    }
    return best;
  }
}
