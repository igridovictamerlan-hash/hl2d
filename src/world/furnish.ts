import type { GameMap, Poi } from './GameMap';
import { SOLID, T } from './tiles';
import { hash2 } from '../core/rng';
import { FURNITURE } from '../config/furniture';

export type FurnitureKind =
  | 'bed' | 'bed_double' | 'cot' | 'nightstand' | 'bookshelf' | 'dresser' | 'stove' | 'crate' | 'plant'
  | 'sofa' | 'armchair' | 'desk' | 'locker' | 'lamp' | 'chair' | 'wardrobe' | 'table' | 'card_table' | 'rug';

/**
 * Предмет обстановки: прямоугольник в px мира (уже с поворотом) и сторона, к которой он
 * прислонён спинкой: 0 — север (стена сверху), 1 — восток, 2 — юг, 3 — запад.
 */
export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 1 | 2 | 3;
  variant: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Box, b: Box, pad: number) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

/**
 * Обстановка всех помещений карты: жилые комнаты домов, общежитий и особняков (по рецептам —
 * вдоль стен, углы первыми, проход у двери свободен, в большой комнате — стол со стульями),
 * плюс мебель Нексуса по точкам шаблона (койки, столы канцелярии, шкафчики OTA, стол для карт).
 * Детерминированно по карте — одинаково при каждом запуске, в JSON не хранится.
 */
export function furnishMap(map: GameMap): Furniture[] {
  const out: Furniture[] = [];
  const ts = map.tileSize;
  const tables = map.poisOf('dorm_table');
  for (const p of map.pois) {
    switch (p.type) {
      case 'home':
        furnishRoom(map, p, p.kind === 'dorm' ? 'dorm' : p.kind === 'villa' ? 'villa' : 'home', out, []);
        break;
      case 'dorm_common': {
        // Стол для карт уже стоит — вокруг него не загромождать.
        const pre = tables.filter((t) => t.x >= p.x && t.y >= p.y && t.x < p.x + p.w! && t.y < p.y + p.h!).map((t) => ({ x: (t.x + 0.5) * ts - 30, y: (t.y + 0.5) * ts - 30, w: 60, h: 60 }));
        furnishRoom(map, p, 'dorm_common', out, pre);
        break;
      }
      case 'villa_living':
        furnishRoom(map, p, 'villa_living', out, []);
        break;
      case 'dorm_table': {
        const cx = (p.x + 0.5) * ts;
        const cy = (p.y + 0.5) * ts;
        out.push({ kind: 'card_table', x: cx - 13, y: cy - 13, w: 26, h: 26, rot: 0, variant: hash2(p.x, p.y, 7) });
        const C = FURNITURE.sizes.chair;
        const d = 20;
        out.push({ kind: 'chair', x: cx - C[0] / 2, y: cy - d - C[1] / 2, w: C[0], h: C[1], rot: 0, variant: 0 });
        out.push({ kind: 'chair', x: cx - C[0] / 2, y: cy + d - C[1] / 2, w: C[0], h: C[1], rot: 2, variant: 0 });
        out.push({ kind: 'chair', x: cx - d - C[0] / 2, y: cy - C[1] / 2, w: C[0], h: C[1], rot: 3, variant: 0 });
        out.push({ kind: 'chair', x: cx + d - C[0] / 2, y: cy - C[1] / 2, w: C[0], h: C[1], rot: 1, variant: 0 });
        break;
      }
      case 'bunk': {
        // Койка казармы изголовьем к ближней стене (сверху или снизу).
        const [a, b] = FURNITURE.sizes.cot;
        const up = map.isSolid(p.x, p.y - 1);
        const x = (p.x + 0.5) * ts - a / 2;
        const y = up ? p.y * ts + 1 : (p.y + 1) * ts - 1 - b;
        out.push({ kind: 'cot', x, y, w: a, h: b, rot: up ? 0 : 2, variant: hash2(p.x, p.y, 3) });
        break;
      }
      case 'clerk_desk': {
        const [a, b] = FURNITURE.sizes.desk;
        const C = FURNITURE.sizes.chair;
        const x = (p.x + 0.5) * ts - a / 2;
        const y = p.y * ts + 1;
        out.push({ kind: 'desk', x, y, w: a, h: b, rot: 0, variant: hash2(p.x, p.y, 5) });
        out.push({ kind: 'chair', x: (p.x + 0.5) * ts - C[0] / 2, y: y + b + 1, w: C[0], h: C[1], rot: 2, variant: 0 });
        break;
      }
      case 'ota_spot': {
        const [a, b] = FURNITURE.sizes.locker;
        const up = map.isSolid(p.x, p.y - 1);
        const x = (p.x + 0.5) * ts - a / 2;
        const y = up ? p.y * ts + 1 : (p.y + 1) * ts - 1 - b;
        out.push({ kind: 'locker', x, y, w: a, h: b, rot: up ? 0 : 2, variant: 0 });
        break;
      }
    }
  }
  return out;
}

/** Расставить рецепт вдоль стен комнаты (пол — прямоугольник p в тайлах). */
function furnishRoom(map: GameMap, p: Poi, recipe: string, out: Furniture[], pre: Box[]): void {
  const F = FURNITURE;
  const ts = map.tileSize;
  const R: Box = { x: p.x * ts, y: p.y * ts, w: (p.w ?? 1) * ts, h: (p.h ?? 1) * ts };
  const seed = hash2(p.x, p.y, 0x5eed);
  const placed: Box[] = [...pre];
  // Проходы: двери и проёмы в кольце стен вокруг комнаты.
  const clear: Box[] = [];
  /** Узкий проход — для кровати в тесной комнате: только сам проём. */
  const narrow: Box[] = [];
  const d = F.doorClear;
  const dn = F.doorClearMin;
  const opening = (tx: number, ty: number) => {
    const t = map.tileAt(tx, ty);
    return t === T.DOOR || SOLID[t] === 0;
  };
  const x0 = p.x;
  const y0 = p.y;
  const x1 = p.x + (p.w ?? 1);
  const y1 = p.y + (p.h ?? 1);
  for (let x = x0; x < x1; x++) {
    if (opening(x, y0 - 1)) {
      clear.push({ x: x * ts, y: R.y, w: ts, h: d });
      narrow.push({ x: x * ts, y: R.y, w: ts, h: dn });
    }
    if (opening(x, y1)) {
      clear.push({ x: x * ts, y: R.y + R.h - d, w: ts, h: d });
      narrow.push({ x: x * ts, y: R.y + R.h - dn, w: ts, h: dn });
    }
  }
  for (let y = y0; y < y1; y++) {
    if (opening(x0 - 1, y)) {
      clear.push({ x: R.x, y: y * ts, w: d, h: ts });
      narrow.push({ x: R.x, y: y * ts, w: dn, h: ts });
    }
    if (opening(x1, y)) {
      clear.push({ x: R.x + R.w - d, y: y * ts, w: d, h: ts });
      narrow.push({ x: R.x + R.w - dn, y: y * ts, w: dn, h: ts });
    }
  }
  const free = (b: Box, keep: readonly Box[] = clear) =>
    b.x >= R.x && b.y >= R.y && b.x + b.w <= R.x + R.w && b.y + b.h <= R.y + R.h &&
    !placed.some((o) => overlap(o, b, F.gap)) && !keep.some((o) => overlap(o, b, 0));
  const add = (kind: FurnitureKind, b: Box, rot: 0 | 1 | 2 | 3, k: number) => {
    placed.push(b);
    out.push({ kind, ...b, rot, variant: hash2(seed, k, 11) });
  };

  // Стол со стульями посередине большой комнаты (в гостиной особняка — и ковёр).
  let k = 0;
  const T0 = F.table;
  const withTable = (recipe === 'home' || recipe === 'villa_living' || recipe === 'dorm') && (p.w ?? 1) >= T0.min[0] && (p.h ?? 1) >= T0.min[1];
  if (recipe === 'villa_living' || (recipe === 'home' && (p.w ?? 1) >= 6 && (p.h ?? 1) >= 4)) {
    const rw = Math.min(R.w - 20, 64);
    const rh = Math.min(R.h - 20, 44);
    if (rw > 20 && rh > 16) out.push({ kind: 'rug', x: R.x + (R.w - rw) / 2, y: R.y + (R.h - rh) / 2, w: rw, h: rh, rot: 0, variant: hash2(seed, 1, 13) });
  }
  // Вдоль стен: углы первыми, стороны — в порядке от зерна комнаты.
  const sides = [0, 1, 2, 3].sort((a, b) => hash2(seed, a, 17) - hash2(seed, b, 17)) as (0 | 1 | 2 | 3)[];
  const tryWall = (kind: FurnitureKind, size: readonly [number, number], keep: readonly Box[]): boolean => {
    const [a, b] = size;
    for (const side of sides) {
      const along = side === 0 || side === 2 ? R.w : R.h;
      const span = along - a - 2;
      if (span < 0) continue;
      // Позиции: от углов к середине.
      const offs: number[] = [];
      for (let o = 1; o <= span / 2 + 1; o += 4) offs.push(o, span - o + 2);
      for (const o of offs) {
        let box: Box;
        if (side === 0) box = { x: R.x + o, y: R.y + 1, w: a, h: b };
        else if (side === 2) box = { x: R.x + o, y: R.y + R.h - 1 - b, w: a, h: b };
        else if (side === 3) box = { x: R.x + 1, y: R.y + o, w: b, h: a };
        else box = { x: R.x + R.w - 1 - b, y: R.y + o, w: b, h: a };
        if (!free(box, keep)) continue;
        add(kind, box, side, k++);
        return true;
      }
    }
    return false;
  };
  let hasBed = false;
  let tabled = false;
  const placeTable = () => {
    if (!withTable) return;
    // Посередине, а если там кровать — со сдвигом к свободной части комнаты.
    const cx = R.x + (R.w - T0.w) / 2;
    const cy = R.y + (R.h - T0.h) / 2;
    let t: Box | null = null;
    for (const [dx, dy] of [[0, 0], [0, 10], [0, -10], [14, 0], [-14, 0], [14, 10], [-14, 10], [14, -10], [-14, -10], [0, 18], [0, -18]]) {
      const c = { x: cx + dx, y: cy + dy, w: T0.w, h: T0.h };
      if (free(c)) {
        t = c;
        break;
      }
    }
    if (t) {
      add('table', t, 0, k++);
      const C = F.sizes.chair;
      const left: Box = { x: t.x - C[0] - 1, y: t.y + (T0.h - C[1]) / 2, w: C[0], h: C[1] };
      const right: Box = { x: t.x + T0.w + 1, y: t.y + (T0.h - C[1]) / 2, w: C[0], h: C[1] };
      if (free(left)) add('chair', left, 3, k++);
      if (free(right)) add('chair', right, 1, k++);
    }
  };
  for (const kind of F.recipes[recipe] ?? []) {
    // Стол — после кровати (кровать важнее).
    if (!tabled && !(kind === 'bed' || kind === 'bed_double')) {
      tabled = true;
      placeTable();
    }
    const bed = kind === 'bed' || kind === 'bed_double';
    // Без кровати жилой комнаты не бывает: в тесной — с узким проходом у двери, потом кровать поменьше.
    if (bed && hasBed && kind === 'bed' && tryWall('bed', F.sizes.bed, clear)) continue;
    if (bed && hasBed) continue;
    if (tryWall(kind as FurnitureKind, F.sizes[kind], clear)) {
      hasBed ||= bed;
      continue;
    }
    if (!bed) continue;
    hasBed =
      tryWall(kind as FurnitureKind, F.sizes[kind], narrow) ||
      (kind === 'bed_double' && (tryWall('bed', F.sizes.bed, clear) || tryWall('bed', F.sizes.bed, narrow))) ||
      tryWall('bed', F.sizes.bed_small, narrow);
  }
}
