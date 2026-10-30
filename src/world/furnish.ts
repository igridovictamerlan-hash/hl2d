import type { GameMap, Poi } from './GameMap';
import { SOLID, T } from './tiles';
import { hash2 } from '../core/rng';
import { FURNITURE } from '../config/furniture';

export type FurnitureKind =
  | 'bed' | 'bed_double' | 'cot' | 'nightstand' | 'bookshelf' | 'dresser' | 'stove' | 'crate' | 'plant'
  | 'sofa' | 'armchair' | 'desk' | 'locker' | 'lamp' | 'chair' | 'wardrobe' | 'table' | 'card_table' | 'rug'
  | 'coat_rack' | 'kitchen_counter' | 'fridge' | 'bathtub' | 'toilet' | 'sink' | 'storage_rack' | 'register'
  // Торговое оборудование (POI shop_fixture): прилавок, витрина со стеклом, барная стойка, стеллаж у стены, островной,
  // холодильник-витрина, вешалка с одеждой, газетная стойка, перфопанель, примерочная, зеркало, столик кафе.
  | 'counter' | 'glass_case' | 'bar' | 'wall_shelf' | 'gondola' | 'cooler' | 'clothes_rail' | 'news_stand' | 'pegboard'
  | 'fitting_booth' | 'mirror' | 'cafe_table';

/** Вид оборудования лавки (POI shop_fixture, sub) → предмет. */
export const FIXTURE_FURNITURE: Record<string, FurnitureKind> = {
  counter: 'counter', case: 'glass_case', bar: 'bar', shelf: 'wall_shelf', gondola: 'gondola', fridge: 'cooler',
  rail: 'clothes_rail', stand: 'news_stand', pegboard: 'pegboard', booth: 'fitting_booth', mirror: 'mirror', table: 'cafe_table',
};

/** Сторона, куда обращено оборудование → сторона стены за ним (rot предмета: 0 — стена сверху). */
const ROT_BEHIND: Record<string, 0 | 1 | 2 | 3> = { S: 0, W: 1, N: 2, E: 3 };

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
 * плюс мебель Управы по точкам шаблона (койки, столы канцелярии, шкафчики OTA, стол для карт).
 * Детерминированно по карте — одинаково при каждом запуске, в JSON не хранится.
 */
export function furnishMap(map: GameMap): Furniture[] {
  const out: Furniture[] = [];
  const ts = map.tileSize;
  const tables = map.poisOf('dorm_table');
  const rooms = map.poisOf('room');
  const fixtures = map.poisOf('shop_fixture');
  const within = (q: Poi, p: Poi) => q.x >= p.x && q.y >= p.y && q.x + (q.w ?? 1) <= p.x + (p.w ?? 1) && q.y + (q.h ?? 1) <= p.y + (p.h ?? 1);
  /** Рецепт по назначению и полосе достатка (kitchen_slum, …), иначе общий. */
  const recipeOf = (kind: string, p: Poi) => {
    const d = map.districtAt(p.x, p.y);
    return d && FURNITURE.recipes[`${kind}_${d}`] ? `${kind}_${d}` : kind;
  };
  for (const p of map.pois) {
    switch (p.type) {
      case 'home':
        // Квартира и комната коммуналки обставлены по комнатам (POI room).
        if (!p.kind && rooms.some((r) => within(r, p))) break;
        furnishRoom(map, p, p.kind === 'dorm' ? 'dorm' : p.kind === 'villa' ? 'villa' : recipeOf('studio', p), out, []);
        break;
      case 'room': {
        // Оборудование лавки уже стоит — вокруг него не загромождать.
        const pre = fixtures.filter((f) => within(f, p)).map((f) => ({ x: f.x * ts, y: f.y * ts, w: (f.w ?? 1) * ts, h: (f.h ?? 1) * ts }));
        furnishRoom(map, p, recipeOf(p.sub ?? 'room', p), out, pre);
        break;
      }
      case 'shop_fixture':
        fixtureItems(map, p, out);
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
      case 'cwu_lounge':
      case 'cwu_canteen':
        furnishRoom(map, p, p.type, out, []);
        break;
      case 'cwu_office':
      case 'cwu_lobby':
      case 'cwu_production': {
        // Стол главы, стойка найма и конвейеры уже стоят — вокруг них свободно.
        const [cx, cy] = FURNITURE.conveyorClear;
        const inside = (t: Poi) => t.x >= p.x && t.y >= p.y && t.x < p.x + p.w! && t.y < p.y + p.h!;
        const pre = map.pois
          .filter((t) => (t.type === 'cwu_head_desk' || t.type === 'cwu_hire' || t.type === 'ration_line' || t.type === 'cwu_store') && inside(t))
          .map((t) => ({ x: (t.x + 0.5) * ts - cx, y: (t.y + 0.5) * ts - cy, w: cx * 2, h: cy * 2 + ts }));
        furnishRoom(map, p, p.type, out, pre);
        break;
      }
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
      case 'clerk_desk':
      case 'cwu_head_desk':
      case 'cwu_hire': {
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

/**
 * Торговое оборудование: предмет во весь прямоугольник клеток (спиной к стене или к продавцу); у столика кафе —
 * стулья с открытых сторон (до двух — друг напротив друга, если можно), на прилавке у места покупателя — касса.
 */
function fixtureItems(map: GameMap, p: Poi, out: Furniture[]): void {
  const ts = map.tileSize;
  const F = FURNITURE;
  const kind = FIXTURE_FURNITURE[p.sub ?? ''];
  if (!kind) return;
  const pad = F.fixtures.inset;
  const w = (p.w ?? 1) * ts;
  const h = (p.h ?? 1) * ts;
  const v = hash2(p.x, p.y, 23);
  // Островное — по длинной стороне; у стены и прилавок — спиной к стене (продавцу).
  const island = kind === 'gondola' || kind === 'cafe_table' || (kind === 'clothes_rail' && !map.isSolid(p.x - 1, p.y) && !map.isSolid(p.x + (p.w ?? 1), p.y));
  const rot: 0 | 1 | 2 | 3 = island ? (w >= h ? 0 : 1) : ROT_BEHIND[p.face ?? 'S'] ?? 0;
  if (kind === 'cafe_table') {
    const s = Math.min(w, h) - 3;
    const cx = p.x * ts + w / 2;
    const cy = p.y * ts + h / 2;
    out.push({ kind, x: cx - s / 2, y: cy - s / 2, w: s, h: s, rot: 0, variant: v });
    const C = F.sizes.chair;
    const open = ([[0, -1, 0], [0, 1, 2], [-1, 0, 3], [1, 0, 1]] as const).filter(([dx, dy]) => map.tileAt(p.x + dx, p.y + dy) === T.INTERIOR);
    // Друг напротив друга, если можно; иначе — первые свободные стороны.
    const pairs = open.filter(([dx, dy]) => open.some(([ex, ey]) => ex === -dx && ey === -dy));
    for (const [dx, dy, r] of (pairs.length >= 2 ? pairs : open).slice(0, 2)) {
      const x = cx + dx * (s / 2 + C[0] / 2 + 1) - C[0] / 2;
      const y = cy + dy * (s / 2 + C[1] / 2 + 1) - C[1] / 2;
      // Спинкой от стола (rot — сторона спинки).
      out.push({ kind: 'chair', x, y, w: C[0], h: C[1], rot: r, variant: 0 });
    }
    return;
  }
  out.push({ kind, x: p.x * ts + pad, y: p.y * ts + pad, w: w - pad * 2, h: h - pad * 2, rot, variant: v });
  if (kind === 'counter' || kind === 'glass_case' || kind === 'bar') {
    // Касса — на клетке прилавка у места покупателя.
    const front = map.poisOf('shop_front').find((q) => q.id === p.id);
    if (!front) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) {
      for (let x = p.x; x < p.x + (p.w ?? 1); x++) {
        if (Math.abs(x - front.x) + Math.abs(y - front.y) !== 1) continue;
        const [a, b] = F.sizes.register;
        out.push({ kind: 'register', x: (x + 0.5) * ts - a / 2, y: (y + 0.5) * ts - b / 2, w: a, h: b, rot: ROT_BEHIND[p.face ?? 'S'] ?? 0, variant: v });
        return;
      }
    }
  }
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
  const withTable = /^(home|villa_living|dorm|cwu_lounge|kitchen|living|room|studio)/.test(recipe) && (p.w ?? 1) >= T0.min[0] && (p.h ?? 1) >= T0.min[1];
  if (recipe === 'cwu_canteen') {
    // Столовая: ряд столов посередине, у каждого — стулья сверху и снизу.
    const C = F.sizes.chair;
    const step = F.canteen.step;
    const n = Math.max(1, Math.floor((R.w - 24) / step));
    const x0 = R.x + (R.w - (n - 1) * step - T0.w) / 2;
    const ty = R.y + (R.h - T0.h) / 2;
    for (let i = 0; i < n; i++) {
      const t: Box = { x: x0 + i * step, y: ty, w: T0.w, h: T0.h };
      placed.push(t);
      out.push({ kind: 'table', ...t, rot: 0, variant: hash2(seed, i, 19) });
      for (const [dx, dy, rot] of [[4, -C[1] - 1, 0], [T0.w - 4 - C[0], -C[1] - 1, 0], [4, T0.h + 1, 2], [T0.w - 4 - C[0], T0.h + 1, 2]] as const) {
        const c: Box = { x: t.x + dx, y: t.y + dy, w: C[0], h: C[1] };
        placed.push(c);
        out.push({ kind: 'chair', ...c, rot, variant: 0 });
      }
    }
  }
  if (recipe === 'villa_living' || /^living|bedroom_upper/.test(recipe) || (/^(home|studio)/.test(recipe) && !recipe.endsWith('_slum') && (p.w ?? 1) >= 6 && (p.h ?? 1) >= 4)) {
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
