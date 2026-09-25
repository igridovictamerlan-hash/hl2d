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
  | 'shop';

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
  | 'shop_counter';

/** Точка интереса в координатах тайлов. */
export interface Poi {
  type: PoiType;
  x: number;
  y: number;
}

/** Карта города: сетка тайлов, сетка зон, точки интереса. Только данные и запросы. */
export class GameMap {
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Динамика дверей (не сохраняется в JSON): 1 — дверь закрыта и перекрывает обзор. */
  readonly doorClosed: Uint8Array;
  /** 1 — дверь заперта и непроходима (камеры КПЗ). */
  readonly doorLocked: Uint8Array;

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
