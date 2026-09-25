import { SOLID, OPAQUE, T } from './tiles';
import type { MapStats } from './mapStats';

export type ZoneKind =
  | 'residential'
  | 'avenue'
  | 'plaza'
  | 'nexus'
  | 'cells'
  | 'industrial'
  | 'restricted'
  | 'checkpoint'
  | 'outlands'
  | 'shop'
  | 'sewer'
  | 'rebel_base'
  | 'black_market';

/** Уровень: город или канализация под ним. */
export type Level = 'city' | 'sewer';

/** Зоны канализации (по ним определяется её прямоугольник на сетке). */
export const UNDERGROUND_KINDS: readonly ZoneKind[] = ['sewer', 'rebel_base', 'black_market'];

export interface Zone {
  id: number;
  kind: ZoneKind;
  name: string;
  /** Символ зоны в JSON-сетке zoneGrid. */
  char: string;
}

export type PoiType =
  | 'plaza_center'
  | 'ration_window'
  | 'nexus_gate'
  | 'nexus_desk'
  | 'nexus_yard'
  | 'cell'
  | 'restricted_gate'
  | 'industrial_yard'
  | 'checkpoint_post'
  | 'outlands_exit'
  | 'recruit_terminal'
  | 'shop_counter'
  | 'hatch'
  | 'sewer_hatch'
  | 'rebel_base'
  | 'rebel_cache'
  | 'black_market'
  | 'trader';

/**
 * Точка интереса в координатах тайлов. Люки (hatch — в городе, sewer_hatch — в канализации)
 * задают якорь 2×2 (x, y — его левый верхний тайл, центр — на стыке четырёх тайлов) и связаны
 * попарно одинаковым id.
 */
export interface Poi {
  type: PoiType;
  x: number;
  y: number;
  id?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Пара люков: центры в px мира. */
export interface HatchPair {
  id: number;
  city: { x: number; y: number };
  sewer: { x: number; y: number };
}

/** Карта города: сетка тайлов, сетка зон, точки интереса. Только данные и запросы. */
export class GameMap {
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Динамика дверей (не сохраняется в JSON): 1 — дверь закрыта и перекрывает обзор. */
  readonly doorClosed: Uint8Array;
  /** 1 — дверь заперта и непроходима (камеры КПЗ). */
  readonly doorLocked: Uint8Array;
  /** Прямоугольник канализации в тайлах (null — карта без неё). */
  readonly underground: Rect | null;
  readonly hatches: HatchPair[];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly tileSize: number,
    readonly tiles: Uint8Array,
    readonly zoneGrid: Uint8Array,
    readonly zones: Zone[],
    readonly pois: Poi[],
    readonly seed: number,
    readonly name: string,
    public stats: MapStats | null = null,
  ) {
    this.worldWidth = width * tileSize;
    this.worldHeight = height * tileSize;
    this.doorClosed = new Uint8Array(width * height);
    this.doorLocked = new Uint8Array(width * height);
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === T.DOOR) this.doorClosed[i] = 1;
    // Канализация — описывающий прямоугольник её зон.
    const ug = new Set(zones.filter((z) => UNDERGROUND_KINDS.includes(z.kind)).map((z) => z.id));
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    if (ug.size) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!ug.has(zoneGrid[y * width + x])) continue;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    this.underground = x1 >= 0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
    this.hatches = [];
    const cityH = pois.filter((p) => p.type === 'hatch');
    for (const p of cityH) {
      const q = pois.find((o) => o.type === 'sewer_hatch' && o.id === p.id);
      if (q && p.id !== undefined) {
        this.hatches.push({ id: p.id, city: { x: (p.x + 1) * tileSize, y: (p.y + 1) * tileSize }, sewer: { x: (q.x + 1) * tileSize, y: (q.y + 1) * tileSize } });
      }
    }
  }

  /** Уровень точки мира: в прямоугольнике канализации — 'sewer'. */
  levelAt(x: number, y: number): Level {
    const u = this.underground;
    if (!u) return 'city';
    const tx = x / this.tileSize;
    const ty = y / this.tileSize;
    return tx >= u.x && ty >= u.y && tx < u.x + u.w && ty < u.y + u.h ? 'sewer' : 'city';
  }

  /** Границы уровня в px мира (для камеры): город — всё левее канализации. */
  levelBounds(level: Level): Rect {
    const ts = this.tileSize;
    const u = this.underground;
    if (!u) return { x: 0, y: 0, w: this.worldWidth, h: this.worldHeight };
    if (level === 'sewer') return { x: u.x * ts, y: u.y * ts, w: u.w * ts, h: u.h * ts };
    return { x: 0, y: 0, w: u.x * ts, h: this.worldHeight };
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  tileAt(tx: number, ty: number): number {
    return this.inBounds(tx, ty) ? this.tiles[ty * this.width + tx] : T.WALL;
  }

  /** За пределами карты — стена. Запертая дверь — тоже стена. */
  isSolid(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.width + tx;
    return SOLID[this.tiles[i]] === 1 || this.doorLocked[i] === 1;
  }

  /** Перекрывает ли тайл обзор (стены и закрытые двери). */
  isOpaque(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.width + tx;
    return OPAQUE[this.tiles[i]] === 1 || this.doorClosed[i] === 1;
  }

  zoneAtTile(tx: number, ty: number): Zone | null {
    if (!this.inBounds(tx, ty)) return null;
    const id = this.zoneGrid[ty * this.width + tx];
    return this.zones[id] ?? null;
  }

  zoneAtWorld(x: number, y: number): Zone | null {
    return this.zoneAtTile(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize));
  }

  zoneByKind(kind: ZoneKind): Zone | undefined {
    return this.zones.find((z) => z.kind === kind);
  }

  poisOf(type: PoiType): Poi[] {
    return this.pois.filter((p) => p.type === type);
  }

  /** Центр тайла в пикселях мира. */
  tileCenter(tx: number, ty: number): { x: number; y: number } {
    return { x: (tx + 0.5) * this.tileSize, y: (ty + 0.5) * this.tileSize };
  }
}
