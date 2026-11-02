import type { Building } from './buildings';
import { FACADES } from '../config/facades';
import { hash2 } from '../core/rng';

/**
 * Каким будет дом в виде ¾ (world/FacadeRenderer.ts рисует): семейство по полосе достатка и ширине, материал стен,
 * окна, дверь, верх фасада (карниз, парапет, свес или щипец), форма и материал кровли, мелочи. Всё — по хэшу дома:
 * у каждого свой облик, одинаковый при каждом построении карты.
 */
type Hsl = { readonly h: number; readonly s: number; readonly l: number };

export type Family = 'slum' | 'amsterdam' | 'munich' | 'london' | 'grand' | 'civic';
/** Верх фасада: карниз, парапет (за ним мансарда), свес крыши; щипцы — ступенчатый, с шеей, колоколом, треугольный. */
export type FacadeTop = 'cornice' | 'parapet' | 'eave' | 'step' | 'neck' | 'bell' | 'spout';
/** Кровля: конёк вдоль улицы, поперёк (щипец к улице), вальмовая, мансарда. */
export type RoofForm = 'ew' | 'ns' | 'hip' | 'mansard';
export type RoofMat = 'tile' | 'pantile' | 'slate' | 'copper';
export type WallMat = 'brick' | 'stucco' | 'stone';
/** Над окном: перемычка, лучковая арка, замковый камень, сандрик-фронтон, крашеный наличник. */
export type WindowHead = 'lintel' | 'arch' | 'keystone' | 'pediment' | 'surround';

export interface FacadeKit {
  family: Family;
  wall: WallMat;
  wallColor: Hsl;
  /** Первый этаж: как стены, руст (лондонская штукатурка) или камень. */
  ground: WallMat | 'rustic';
  groundColor: Hsl;
  trim: string;
  /** Этажей по фасаду (ограничит глубина дома). */
  storeys: number;
  bay: number;
  win: number;
  head: WindowHead;
  /** Переплёт: подъёмное окно (сверху и снизу по стеклу) или створки крестом. */
  bars: 'sash' | 'casement';
  shutters: string | null;
  /** Доля окон с ящиком цветов, со шторами. */
  boxes: number;
  curtains: number;
  balcony: boolean;
  oriel: boolean;
  door: string;
  fanlight: boolean;
  porch: 'plain' | 'pilasters' | 'portico';
  top: FacadeTop;
  roof: RoofForm;
  roofMat: RoofMat;
  roofColor: Hsl;
  dormers: boolean;
  grime: number;
  posters: boolean;
  laundry: boolean;
  banners: boolean;
  /** Доля разбитых и заколоченных окон (Слобода). */
  broken: number;
  seed: number;
}

const r01 = (seed: number, k: number): number => hash2(seed, k, 0x7fa) / 4294967296;
const pick = <V>(list: readonly V[], seed: number, k: number): V => list[hash2(seed, k, 0x3c1) % list.length];

/** Набор дома b; width — ширина главного фасада в тайлах (узкий дом — щипец к улице). */
export function facadeKit(b: Building, width: number): FacadeKit {
  const seed = hash2(b.id, b.x0 * 7 + b.y0, 0x5f);
  const F = FACADES;
  const narrow = width <= 6;
  let family: Family;
  if (b.kind === 'civic' || b.kind === 'canteen' || b.kind === 'dorm') family = 'civic';
  else if (b.kind === 'villa') family = 'grand';
  else if (b.district === 'slum') family = 'slum';
  else if (b.district === 'upper') family = r01(seed, 1) < 0.62 ? 'london' : 'grand';
  else family = narrow ? (r01(seed, 2) < 0.72 ? 'amsterdam' : 'munich') : r01(seed, 3) < 0.7 ? 'munich' : 'amsterdam';

  const base = Math.max(1, Math.min(4, b.storeys));
  const k: FacadeKit = {
    family, wall: 'brick', wallColor: pick(F.brick.amsterdam, seed, 4), ground: 'brick', groundColor: pick(F.brick.amsterdam, seed, 4),
    trim: F.trim.white, storeys: base, bay: F.bay[family], win: F.window[family], head: 'lintel', bars: 'sash', shutters: null,
    boxes: 0, curtains: 0.5, balcony: false, oriel: false, door: pick(F.doors.amsterdam, seed, 5), fanlight: false, porch: 'plain',
    top: 'cornice', roof: 'ew', roofMat: 'tile', roofColor: pick(F.roof.tile, seed, 6), dormers: false, grime: F.grime[family],
    posters: false, laundry: false, banners: false, broken: 0, seed,
  };
  switch (family) {
    case 'slum': {
      const plaster = r01(seed, 7) < 0.3;
      k.wall = plaster ? 'stucco' : 'brick';
      k.wallColor = plaster ? pick(F.stucco.slum, seed, 8) : pick(F.brick.slum, seed, 8);
      k.ground = k.wall;
      k.groundColor = k.wallColor;
      k.trim = F.trim.dark;
      k.storeys = Math.max(1, Math.min(3, base));
      k.head = r01(seed, 9) < 0.5 ? 'arch' : 'lintel';
      k.shutters = r01(seed, 10) < 0.35 ? pick(F.shutters, seed, 11) : null;
      k.boxes = 0.04;
      k.curtains = 0.35;
      k.door = pick(F.doors.slum, seed, 12);
      k.top = narrow && r01(seed, 13) < 0.35 ? 'spout' : 'eave';
      k.roof = k.top === 'spout' ? 'ns' : 'ew';
      k.roofMat = r01(seed, 14) < 0.5 ? 'slate' : 'tile';
      k.roofColor = pick(k.roofMat === 'slate' ? F.roof.slate : F.roof.tile, seed, 15);
      k.dormers = r01(seed, 16) < 0.2;
      k.posters = r01(seed, 17) < 0.55;
      k.laundry = r01(seed, 18) < 0.4;
      k.broken = 0.22;
      break;
    }
    case 'amsterdam': {
      k.wall = 'brick';
      k.wallColor = pick(F.brick.amsterdam, seed, 19);
      k.ground = 'brick';
      k.groundColor = k.wallColor;
      k.trim = F.trim.white;
      k.storeys = Math.max(3, Math.min(4, base + 1));
      k.head = r01(seed, 20) < 0.55 ? 'keystone' : 'arch';
      k.boxes = 0.12;
      k.door = pick(F.doors.amsterdam, seed, 21);
      k.fanlight = r01(seed, 22) < 0.6;
      const g = r01(seed, 23);
      k.top = !narrow ? 'cornice' : g < 0.3 ? 'step' : g < 0.62 ? 'neck' : g < 0.86 ? 'bell' : 'spout';
      k.roof = k.top === 'cornice' ? 'ew' : 'ns';
      k.roofMat = r01(seed, 24) < 0.7 ? 'pantile' : 'tile';
      k.roofColor = pick(k.roofMat === 'pantile' ? F.roof.pantile : F.roof.tile, seed, 25);
      k.dormers = k.roof === 'ew';
      break;
    }
    case 'munich': {
      k.wall = 'stucco';
      k.wallColor = pick(F.stucco.munich, seed, 26);
      k.ground = 'stucco';
      k.groundColor = k.wallColor;
      k.trim = r01(seed, 27) < 0.6 ? F.trim.white : F.trim.cream;
      k.storeys = Math.max(2, Math.min(3, base + 1));
      k.head = 'surround';
      k.bars = 'casement';
      k.shutters = r01(seed, 28) < 0.6 ? pick(F.shutters, seed, 29) : null;
      k.boxes = 0.5;
      k.oriel = width >= 8 && r01(seed, 30) < 0.55;
      k.door = pick(F.doors.munich, seed, 31);
      k.fanlight = r01(seed, 32) < 0.3;
      k.top = narrow && r01(seed, 33) < 0.35 ? (r01(seed, 34) < 0.5 ? 'step' : 'bell') : 'eave';
      k.roof = k.top === 'eave' ? 'ew' : 'ns';
      k.roofMat = 'tile';
      k.roofColor = pick(F.roof.tile, seed, 35);
      k.dormers = k.roof === 'ew';
      break;
    }
    case 'london': {
      const stuccoUp = r01(seed, 36) < 0.4;
      k.wall = stuccoUp ? 'stucco' : 'brick';
      k.wallColor = stuccoUp ? pick(F.stucco.london, seed, 37) : pick(F.brick.london, seed, 37);
      k.ground = 'rustic';
      k.groundColor = pick(F.stucco.london, seed, 38);
      k.trim = F.trim.white;
      k.storeys = Math.max(3, Math.min(4, base + 1));
      k.head = stuccoUp ? 'pediment' : 'lintel';
      k.boxes = 0.12;
      k.curtains = 0.7;
      k.balcony = r01(seed, 39) < 0.7;
      k.door = pick(F.doors.london, seed, 40);
      k.fanlight = r01(seed, 41) < 0.9;
      k.porch = r01(seed, 42) < 0.25 ? 'portico' : 'pilasters';
      k.top = r01(seed, 43) < 0.6 ? 'parapet' : 'cornice';
      k.roof = r01(seed, 44) < 0.6 ? 'mansard' : 'ew';
      k.roofMat = 'slate';
      k.roofColor = pick(F.roof.slate, seed, 45);
      k.dormers = true;
      break;
    }
    case 'grand': {
      k.wall = 'stone';
      k.wallColor = pick(F.stone, seed, 46);
      k.ground = 'stone';
      k.groundColor = k.wallColor;
      k.trim = F.trim.stone;
      k.storeys = Math.max(3, Math.min(4, base + 1));
      k.head = 'pediment';
      k.bars = 'casement';
      k.curtains = 0.7;
      k.balcony = r01(seed, 47) < 0.5;
      k.oriel = width >= 9 && r01(seed, 48) < 0.3;
      k.door = pick(F.doors.london, seed, 49);
      k.fanlight = true;
      k.porch = 'portico';
      k.top = 'cornice';
      k.roof = r01(seed, 50) < 0.6 ? 'hip' : 'mansard';
      k.roofMat = r01(seed, 51) < 0.7 ? 'slate' : 'copper';
      k.roofColor = pick(k.roofMat === 'slate' ? F.roof.slate : F.roof.copper, seed, 52);
      k.dormers = true;
      break;
    }
    case 'civic': {
      const brick = b.kind === 'dorm';
      k.wall = brick ? 'brick' : 'stone';
      k.wallColor = brick ? pick(F.brick.slum, seed, 53) : pick(F.stone, seed, 53);
      k.ground = k.wall;
      k.groundColor = k.wallColor;
      k.trim = brick ? F.trim.stone : F.trim.cream;
      k.storeys = Math.max(2, Math.min(3, base + 1));
      k.head = 'lintel';
      k.bars = 'casement';
      k.curtains = 0.1;
      k.door = pick(F.doors.civic, seed, 54);
      k.fanlight = !brick;
      k.porch = brick ? 'plain' : 'portico';
      k.top = 'cornice';
      k.roof = 'hip';
      k.roofMat = brick ? 'slate' : r01(seed, 55) < 0.45 ? 'copper' : 'slate';
      k.roofColor = pick(k.roofMat === 'slate' ? F.roof.slate : F.roof.copper, seed, 56);
      k.banners = !brick && width >= 8;
      k.posters = brick && r01(seed, 57) < 0.5;
      break;
    }
  }
  return k;
}

/** Высоты этажей снизу вверх: первый, бельэтаж (у Лондона и доходного дома выше), остальные. */
export function storeyBands(k: FacadeKit, storeys: number): number[] {
  const S = FACADES.size;
  const out: number[] = [S.ground];
  for (let st = 1; st < storeys; st++) out.push(st === 1 && (k.family === 'london' || k.family === 'grand') ? S.piano : S.upper);
  return out;
}

/** Высота верха фасада: карниз, парапет или свес крыши. */
export function topHeight(k: FacadeKit): number {
  const S = FACADES.size;
  return k.top === 'parapet' ? S.parapet : k.top === 'cornice' ? S.cornice : S.eave;
}

/** Высота фасада в пикселях мира на storeys этажей (этажи и верх). */
export function facadeHeight(k: FacadeKit, storeys: number): number {
  return storeyBands(k, storeys).reduce((a, h) => a + h, 0) + topHeight(k);
}
