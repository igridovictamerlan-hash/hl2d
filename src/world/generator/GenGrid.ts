import { SOLID, T, type TileId } from '../tiles';
import type { Rect } from '../../core/math';
import { ALLEY } from '../mapStats';

/** Сохранённый кусок сетки для отката неудачной детали. */
export interface Snapshot {
  rect: Rect;
  tiles: Uint8Array;
}

/**
 * Рабочая сетка генератора. locked — защищённые тайлы (городская стена, штампы Нексуса и
 * запретной зоны): их не трогают фичи и тоннели связности.
 */
export class GenGrid {
  readonly tiles: Uint8Array;
  readonly zones: Uint8Array;
  readonly locked: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly border: number,
  ) {
    this.tiles = new Uint8Array(w * h).fill(T.WALL);
    this.zones = new Uint8Array(w * h);
    this.locked = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < border || y < border || x >= w - border || y >= h - border) this.locked[y * w + x] = 1;
      }
    }
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.tiles[y * this.w + x] : T.WALL;
  }

  passable(x: number, y: number): boolean {
    return this.inside(x, y) && SOLID[this.tiles[y * this.w + x]] === 0;
  }

  isLocked(x: number, y: number): boolean {
    return !this.inside(x, y) || this.locked[y * this.w + x] === 1;
  }

  /** Ставит тайл, если он не заблокирован (или force). */
  set(x: number, y: number, t: TileId, force = false): boolean {
    if (!this.inside(x, y)) return false;
    const i = y * this.w + x;
    if (!force && this.locked[i]) return false;
    this.tiles[i] = t;
    return true;
  }

  fillRect(r: Rect, t: TileId, force = false): void {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.set(x, y, t, force);
  }

  /** Вырезает проход: стены превращаются в t, уже проходимые тайлы не меняются. */
  carveRect(r: Rect, t: TileId): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!this.passable(x, y)) this.set(x, y, t);
      }
    }
  }

  lockRect(r: Rect): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) if (this.inside(x, y)) this.locked[y * this.w + x] = 1;
    }
  }

  setZoneRect(r: Rect, zone: number): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) if (this.inside(x, y)) this.zones[y * this.w + x] = zone;
    }
  }

  /** Все тайлы прямоугольника — незаблокированные стены. */
  isSolidFree(r: Rect): boolean {
    if (r.x < 0 || r.y < 0 || r.x + r.w > this.w || r.y + r.h > this.h) return false;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * this.w + x;
        if (this.locked[i] || SOLID[this.tiles[i]] === 0) return false;
      }
    }
    return true;
  }

  snapshot(r: Rect): Snapshot {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(this.w, r.x + r.w);
    const y1 = Math.min(this.h, r.y + r.h);
    const rect = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    const tiles = new Uint8Array(rect.w * rect.h);
    for (let y = 0; y < rect.h; y++) {
      tiles.set(this.tiles.subarray((y0 + y) * this.w + x0, (y0 + y) * this.w + x0 + rect.w), y * rect.w);
    }
    return { rect, tiles };
  }

  restore(s: Snapshot): void {
    const { rect, tiles } = s;
    for (let y = 0; y < rect.h; y++) {
      this.tiles.set(tiles.subarray(y * rect.w, (y + 1) * rect.w), (rect.y + y) * this.w + rect.x);
    }
  }

  /** Длина прямого участка переулка через (x, y) вдоль оси (dx, dy). */
  runThrough(x: number, y: number, dx: number, dy: number): number {
    if (!ALLEY[this.get(x, y)]) return 0;
    let n = 1;
    for (let k = 1; ALLEY[this.get(x + dx * k, y + dy * k)]; k++) n++;
    for (let k = 1; ALLEY[this.get(x - dx * k, y - dy * k)]; k++) n++;
    return n;
  }

  /** Максимальный прямой участок через любую клетку прямоугольника (по обеим осям). */
  maxRunIn(r: Rect): number {
    let best = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        best = Math.max(best, this.runThrough(x, y, 1, 0), this.runThrough(x, y, 0, 1));
      }
    }
    return best;
  }

  countPassable(): number {
    let n = 0;
    for (let i = 0; i < this.tiles.length; i++) if (SOLID[this.tiles[i]] === 0) n++;
    return n;
  }
}
