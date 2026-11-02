import type { GameMap } from '../world/GameMap';
import type { NavGrid } from '../world/NavGrid';
import type { EntityManager } from '../entities/EntityManager';
import type { Character } from '../entities/Character';
import { T } from '../world/tiles';
import { DOORS } from '../config/vision';
import type { Locks } from './Locks';

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
  /** Замок с ключом (systems/Locks.ts), -1 — без замка. */
  lock: number;
  /** Куда «внутрь» от центра (в дом, в комнату) — единичный вектор; null — без замка. */
  inside: { x: number; y: number } | null;
  /** Закрыта на замок: стена для столкновений (GameMap.doorBarred), путь — по ключам (Locks.blockerFor). */
  barred: boolean;
  /** Выбита: стоит открытой, пока не починят. */
  broken: boolean;
}

const near: Character[] = [];

/**
 * Двери: группа соседних тайлов DOOR — одна дверь. Открывается, когда рядом кто-то есть,
 * закрывается через DOORS.closeDelay. Закрытая перекрывает обзор, запертая — ещё и проход
 * (камеры КПЗ). Запирание пересчитывает навигационную сетку вокруг двери.
 * Дверь на замке с ключом (дом, комната, закрытая лавка — systems/Locks.ts) открывается только тому, кто пройдёт
 * (ключ, служба, изнутри), закрывшись — снова заперта; кто стоит в проёме, тот не мешает закрыться позже.
 * Выбитая — открыта, пока не починят.
 */
export class DoorSystem {
  readonly groups: DoorGroup[] = [];
  /** Замки (задаёт Game и simHarness после жилья и лавок). */
  locks: Locks | null = null;
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
        lock: -1, inside: null, barred: false, broken: false,
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

  /** Круг (x, y, r) задевает тайлы двери g. */
  private inDoorway(g: DoorGroup, x: number, y: number, r: number): boolean {
    const ts = this.map.tileSize;
    const b = g.bounds;
    const cx = Math.max(b.x0 * ts, Math.min(x, (b.x1 + 1) * ts));
    const cy = Math.max(b.y0 * ts, Math.min(y, (b.y1 + 1) * ts));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  }

  /** Закрыта на замок (стена для столкновений) или нет. */
  private setBarred(g: DoorGroup, barred: boolean): void {
    if (g.barred === barred) return;
    g.barred = barred;
    for (const t of g.tiles) this.map.doorBarred[t] = barred ? 1 : 0;
  }

  update(entities: EntityManager, dt: number): void {
    this.acc += dt;
    if (this.acc < DOORS.interval) return;
    const step = this.acc;
    this.acc = 0;
    const locks = this.locks;
    for (const g of this.groups) {
      if (g.locked) continue;
      if (g.broken) {
        this.setBarred(g, false);
        if (g.closed) this.setClosed(g, false);
        continue;
      }
      const list = entities.near(g.x, g.y, g.half + DOORS.openRadius, near);
      const keyed = !!locks && g.lock >= 0 && locks.engaged(g.lock);
      let someone = false;
      if (!keyed) someone = list.length > 0;
      else for (const c of list) if (locks!.canPass(c, g)) {
        someone = true;
        break;
      }
      // В проёме кто-то стоит (прошёл следом, оказался в дверях) — замок на него не закрыть.
      const inDoorway = keyed && list.some((c) => c.alive && this.inDoorway(g, c.x, c.y, c.radius));
      if (someone) {
        if (keyed && g.barred) locks!.stats.opened++;
        this.setBarred(g, false);
        if (g.closed) this.setClosed(g, false);
        g.closeTimer = DOORS.closeDelay;
      } else if (!g.closed) {
        g.closeTimer -= step;
        if (g.closeTimer <= 0 && !inDoorway) {
          this.setClosed(g, true);
          if (keyed) this.setBarred(g, true);
        }
      } else this.setBarred(g, keyed && !inDoorway);
    }
  }
}
