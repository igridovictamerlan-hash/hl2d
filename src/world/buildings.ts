import type { District, GameMap, Poi, ZoneKind } from './GameMap';
import { T } from './tiles';
import { computeLots } from './houses';
import { HEIGHT_UNIT } from './shadows';

/**
 * Здания для крыш и фасадов (world/RoofRenderer.ts): кто под какой крышей. Дом в ряду вдоль улицы — по POI facade;
 * дом с помещениями — связный пол, двери и укрытия внутри плюс стены вокруг; глухая застройка — по участкам
 * (computeLots), как у прежних крыш. Тайл в одном здании; общая стена соседей — у того, кто нашёл её первым.
 */
export type BuildingKind = 'house' | 'shop' | 'cafe' | 'canteen' | 'dorm' | 'villa' | 'civic' | 'mass';

export interface Building {
  id: number;
  kind: BuildingKind;
  district: District;
  /** Рамка тайлов (включительно). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Индексы тайлов под крышей. */
  tiles: number[];
  /** Этажей (по высоте теней MapRenderer.heights; без них — 1). */
  storeys: number;
  /** Входные двери: тайл двери и сторона улицы (0 — север, 1 — восток, 2 — юг, 3 — запад). */
  doors: { x: number; y: number; side: 0 | 1 | 2 | 3 }[];
  /** Дом вдоль улицы (лавка, кафе, столовая, жилой) — его POI. */
  facade: Poi | null;
}

export interface Buildings {
  list: Building[];
  /** id здания на тайл (-1 — открытое место). */
  of: Int32Array;
}

/** Зоны казённых зданий: бетонная кровля с антеннами. */
const CIVIC: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['nexus', 'cells', 'restricted', 'checkpoint', 'arsenal', 'prison', 'academy', 'cwu_hq', 'ges', 'industrial']);

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/** Пол и двери помещения; укрытие — если внутри (ни один сосед не открытая земля). */
function indoorAt(map: GameMap, x: number, y: number): boolean {
  const t = map.tileAt(x, y);
  if (t === T.INTERIOR || t === T.DOOR) return true;
  if (t !== T.BARRIER) return false;
  for (let k = 0; k < 4; k++) if (openAt(map, x + DX[k], y + DY[k])) return false;
  return true;
}

/** Открытая земля: улица, переулок, площадь, двор, сад — где крыши нет. */
function openAt(map: GameMap, x: number, y: number): boolean {
  const t = map.tileAt(x, y);
  return t === T.STREET || t === T.FLOOR || t === T.PLAZA || t === T.COURTYARD || t === T.ARCH || t === T.GATE || t === T.GARDEN || t === T.WASTE;
}

export function computeBuildings(map: GameMap, heights?: Uint8Array): Buildings {
  const { width: w, height: h } = map;
  const n = w * h;
  const of = new Int32Array(n).fill(-1);
  const list: Building[] = [];
  const city = map.underground;
  const inCity = (x: number, y: number) => map.levelAt((x + 0.5) * map.tileSize, (y + 0.5) * map.tileSize) === 'city' && (!city || x < city.x);
  const add = (kind: BuildingKind, tiles: number[], facade: Poi | null): Building => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1, top = 0;
    for (const i of tiles) {
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (heights && heights[i] > top) top = heights[i];
    }
    const b: Building = {
      id: list.length, kind, district: map.districtAt((x0 + x1) >> 1, (y0 + y1) >> 1) ?? 'old', x0, y0, x1, y1, tiles,
      storeys: Math.max(1, Math.round(top / HEIGHT_UNIT)), doors: [], facade,
    };
    for (const i of tiles) of[i] = b.id;
    list.push(b);
    return b;
  };

  // 1. Дома в ряду вдоль улицы — прямоугольник POI без улицы (ниша входа у ступенчатого фасада — улица).
  for (const p of map.poisOf('facade')) {
    const tiles: number[] = [];
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) {
      for (let x = p.x; x < p.x + (p.w ?? 1); x++) {
        const i = y * w + x;
        if (of[i] < 0 && !openAt(map, x, y)) tiles.push(i);
      }
    }
    if (!tiles.length) continue;
    const kind: BuildingKind = p.use === 'shop' ? 'shop' : p.use === 'cafe' ? 'cafe' : p.use === 'canteen' ? 'canteen' : 'house';
    add(kind, tiles, p);
  }

  // 2. Дома с помещениями: связный пол (с дверями и укрытиями внутри) и стены вокруг него.
  const villa = new Set<number>();
  const dorm = new Set<number>();
  for (const p of map.poisOf('home')) {
    if (p.kind !== 'villa' && p.kind !== 'dorm') continue;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) (p.kind === 'villa' ? villa : dorm).add(y * w + x);
  }
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    const sx = start % w;
    const sy = (start - sx) / w;
    if (of[start] >= 0 || !indoorAt(map, sx, sy) || !inCity(sx, sy)) continue;
    const region: number[] = [];
    of[start] = -2;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (of[j] !== -1 || !indoorAt(map, nx, ny)) continue;
        of[j] = -2;
        stack.push(j);
      }
    }
    const tiles = [...region];
    for (const i of region) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (of[j] === -1 && map.tiles[j] === T.WALL) {
            of[j] = -2;
            tiles.push(j);
          }
        }
      }
    }
    const zk = map.zoneAtTile(sx, sy)?.kind;
    const kind: BuildingKind = region.some((i) => villa.has(i)) ? 'villa' : region.some((i) => dorm.has(i)) ? 'dorm' : zk && CIVIC.has(zk) ? 'civic' : zk === 'canteen' ? 'canteen' : 'house';
    add(kind, tiles, null);
  }

  // 3. Глухая застройка — участками, как прежние крыши.
  const rest = Uint8Array.from(map.tiles, (t, i) => (of[i] < 0 && t === T.WALL && inCity(i % w, Math.floor(i / w)) ? T.WALL : T.INTERIOR));
  const lots = computeLots(w, h, rest, map.seed | 0);
  const byLot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const l = lots.lot[i];
    if (l < 0) continue;
    let a = byLot.get(l);
    if (!a) byLot.set(l, (a = []));
    a.push(i);
  }
  for (const tiles of byLot.values()) {
    const x = tiles[0] % w;
    const zk = map.zoneAtTile(x, Math.floor(tiles[0] / w))?.kind;
    add(zk && CIVIC.has(zk) ? 'civic' : 'mass', tiles, null);
  }

  // Входные двери: дверь здания у открытой земли.
  for (const b of list) {
    for (const i of b.tiles) {
      if (map.tiles[i] !== T.DOOR) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 4; k++) {
        if (!openAt(map, x + DX[k], y + DY[k])) continue;
        b.doors.push({ x, y, side: k as 0 | 1 | 2 | 3 });
        break;
      }
    }
  }
  for (let i = 0; i < n; i++) if (of[i] < -1) of[i] = -1;
  return { list, of };
}
