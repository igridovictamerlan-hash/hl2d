import type { GameMap } from '../world/GameMap';
import type { NavGrid } from '../world/NavGrid';
import type { EntityManager } from '../entities/EntityManager';
import type { Character } from '../entities/Character';
import { T } from '../world/tiles';
import { DOORS } from '../config/vision';

export interface DoorGroup {
  id: number;
  tiles: number[];
  /** Центр в px мира. */
  x: number;
  y: number;
  /** Половина размера двери, px. */
  half: number;
  closed: boolean;
  locked: boolean;
  closeTimer: number;
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

const near: Character[] = [];

/**
 * Двери: группа соседних тайлов DOOR — одна дверь. Открывается, когда рядом кто-то есть,
 * закрывается через DOORS.closeDelay. Закрытая перекрывает обзор, запертая — ещё и проход
 * (камеры КПЗ). Запирание пересчитывает навигационную сетку вокруг двери.
 */
export class DoorSystem {
  readonly groups: DoorGroup[] = [];
  private readonly byTile: Int32Array;
  private acc = 0;

  constructor(
    private readonly map: GameMap,
    private readonly nav: NavGrid,
  ) {
    const { width: w, tiles } = map;
    this.byTile = new Int32Array(tiles.length).fill(-1);
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== T.DOOR || this.byTile[i] >= 0) continue;
      const id = this.groups.length;
      const list: number[] = [];
      const stack = [i];
      this.byTile[i] = id;
      while (stack.length) {
        const c = stack.pop()!;
        list.push(c);
        const x = c % w;
        for (const n of [c - 1, c + 1, c - w, c + w]) {
          if (n < 0 || n >= tiles.length || tiles[n] !== T.DOOR || this.byTile[n] >= 0) continue;
          if (Math.abs((n % w) - x) > 1) continue;
          this.byTile[n] = id;
          stack.push(n);
        }
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of list) {
        const tx = t % w;
        const ty = (t - tx) / w;
        x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty);
      }
      const ts = map.tileSize;
      this.groups.push({
        id, tiles: list,
        x: ((x0 + x1 + 1) / 2) * ts, y: ((y0 + y1 + 1) / 2) * ts,
        half: (Math.max(x1 - x0, y1 - y0) + 1) * ts * 0.5,
        closed: true, locked: false, closeTimer: 0,
        bounds: { x0, y0, x1, y1 },
      });
    }
  }

  groupAtTile(tx: number, ty: number): DoorGroup | null {
    if (!this.map.inBounds(tx, ty)) return null;
    const id = this.byTile[ty * this.map.width + tx];
    return id >= 0 ? this.groups[id] : null;
  }

  /** Ближайшая дверь к точке в пределах maxDist, px. */
  nearest(x: number, y: number, maxDist: number): DoorGroup | null {
    let best: DoorGroup | null = null;
    let bestD = maxDist;
    for (const g of this.groups) {
      const d = Math.hypot(g.x - x, g.y - y) - g.half;
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  }

  private setClosed(g: DoorGroup, closed: boolean): void {
    g.closed = closed;
    for (const t of g.tiles) this.map.doorClosed[t] = closed ? 1 : 0;
  }

  setLocked(g: DoorGroup, locked: boolean): void {
    if (g.locked === locked) return;
    g.locked = locked;
    if (locked) this.setClosed(g, true);
    for (const t of g.tiles) this.map.doorLocked[t] = locked ? 1 : 0;
    this.nav.refresh(g.bounds.x0, g.bounds.y0, g.bounds.x1, g.bounds.y1);
  }

  /** Открыть сейчас (например, при запирании/отпирании камеры) — закроется сама. */
  open(g: DoorGroup): void {
    if (g.locked) return;
    this.setClosed(g, false);
    g.closeTimer = DOORS.closeDelay;
  }

  update(entities: EntityManager, dt: number): void {
    this.acc += dt;
    if (this.acc < DOORS.interval) return;
    const step = this.acc;
    this.acc = 0;
    for (const g of this.groups) {
      if (g.locked) continue;
      const someone = entities.near(g.x, g.y, g.half + DOORS.openRadius, near).length > 0;
      if (someone) {
        if (g.closed) this.setClosed(g, false);
        g.closeTimer = DOORS.closeDelay;
      } else if (!g.closed) {
        g.closeTimer -= step;
        if (g.closeTimer <= 0) this.setClosed(g, true);
      }
    }
  }
}
