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
const NOBODY: Character[] = [];

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
  /**
   * Сетка дверей по ячейкам DOORS.cell px (CSR: cellStart/cellDoors): в ячейке — двери, до которых из неё можно
   * дотянуться (центр ближе g.half + openRadius). Проверка идёт от людей: дверь, рядом с которой никого, не спрашивает
   * хэш — раньше каждая из ~1200 дверей делала запрос «кто рядом» 10 раз в секунду.
   */
  private readonly cellCols: number;
  private readonly cellRows: number;
  private readonly cellStart: Int32Array;
  private readonly cellDoors: Int32Array;
  /** Метка «рядом кто-то есть» на этом шаге (сравнение с stamp). */
  private readonly mark: Int32Array;
  private stamp = 0;

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
    const cs = DOORS.cell;
    this.cellCols = Math.max(1, Math.ceil((w * map.tileSize) / cs));
    this.cellRows = Math.max(1, Math.ceil((map.height * map.tileSize) / cs));
    const spans: number[] = [];
    const count = new Int32Array(this.cellCols * this.cellRows + 1);
    for (const g of this.groups) {
      const r = g.half + DOORS.openRadius + 1;
      const x0 = this.col(g.x - r), x1 = this.col(g.x + r);
      const y0 = this.row(g.y - r), y1 = this.row(g.y + r);
      spans.push(x0, x1, y0, y1);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) count[cy * this.cellCols + cx + 1]++;
    }
    for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
    this.cellStart = count.slice();
    this.cellDoors = new Int32Array(count[count.length - 1]);
    for (const g of this.groups) {
      const k = g.id * 4;
      for (let cy = spans[k + 2]; cy <= spans[k + 3]; cy++)
        for (let cx = spans[k]; cx <= spans[k + 1]; cx++) this.cellDoors[count[cy * this.cellCols + cx]++] = g.id;
    }
    this.mark = new Int32Array(this.groups.length);
  }

  private col(x: number): number {
    return Math.max(0, Math.min(this.cellCols - 1, Math.floor(x / DOORS.cell)));
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.cellRows - 1, Math.floor(y / DOORS.cell)));
  }

  /** Отметить двери, рядом с которыми кто-то из хэша: только у них запрос «кто рядом» может быть не пуст. */
  private markNear(entities: EntityManager): number {
    const stamp = ++this.stamp;
    const R = DOORS.openRadius + 1;
    for (const c of entities.hashed) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const i = this.row(c.y) * this.cellCols + this.col(c.x);
      for (let k = this.cellStart[i], e = this.cellStart[i + 1]; k < e; k++) {
        const id = this.cellDoors[k];
        if (this.mark[id] === stamp) continue;
        const g = this.groups[id];
        const r = g.half + R;
        const dx = c.x - g.x;
        const dy = c.y - g.y;
        if (dx * dx + dy * dy <= r * r) this.mark[id] = stamp;
      }
    }
    return stamp;
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
    const stamp = this.markNear(entities);
    for (const g of this.groups) {
      if (g.locked) continue;
      if (g.broken) {
        this.setBarred(g, false);
        if (g.closed) this.setClosed(g, false);
        continue;
      }
      // Рядом никого из хэша — запрос «кто рядом» вернул бы пусто.
      const list = this.mark[g.id] === stamp ? entities.near(g.x, g.y, g.half + DOORS.openRadius, near) : NOBODY;
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
