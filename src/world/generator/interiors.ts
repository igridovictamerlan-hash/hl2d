/** Описание — docs/generator.md («Планировка помещений»). */
import type { District } from '../GameMap';
import { T } from '../tiles';
import { buildAnchorWalk, labelComponents } from '../connectivity';
import { hash2 } from '../../core/rng';
import { INTERIORS } from '../../config/interiors';

/** Клетка плана: пол, стена, дверь, оборудование (прилавок, стеллаж — укрытие: не пройти, видно поверх). */
export const CELL = { FLOOR: 0, WALL: 1, DOOR: 2, FIX: 3 } as const;

/** Назначение комнаты: жильё (прихожая, коридор коммуналки, кухня, гостиная, спальня, санузел, студия, комната
 * коммуналки) и лавки (торговый зал, подсобка, зал кафе, кухня кафе). */
export type RoomKind =
  | 'hall' | 'corridor' | 'kitchen' | 'living' | 'bedroom' | 'bath' | 'studio' | 'room'
  | 'sales' | 'backroom' | 'cafe' | 'cafe_kitchen';

/** Торговое оборудование: прилавок, витрина со стеклом, барная стойка, стеллаж у стены, островной стеллаж,
 * холодильник, вешалка, газетная стойка, перфопанель с инструментом, примерочная, зеркало, столик кафе. */
export type FixtureKind =
  | 'counter' | 'case' | 'bar' | 'shelf' | 'gondola' | 'fridge' | 'rail' | 'stand' | 'pegboard' | 'booth' | 'mirror' | 'table';

/** Сторона в плане: 0 — к входу (r−), 1 — c+, 2 — вглубь (r+), 3 — c−. */
export type Side = 0 | 1 | 2 | 3;

/** Прямоугольник клеток плана (включительно). */
export interface Box {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** Комната плана; dwelling — отдельное жильё (комната коммуналки — своя семья). */
export interface PlanRoom extends Box {
  kind: RoomKind;
  dwelling: boolean;
}

/** Оборудование: прямоугольник, вид и сторона, обращённая к покупателю (у стенного — от стены). */
export interface PlanFixture extends Box {
  kind: FixtureKind;
  face: Side;
}

/** Клетка плана — левый верхний тайл якоря 2×2 (пешка стоит на стыке четырёх). */
export interface Spot {
  c: number;
  r: number;
}

/**
 * План помещения W × D клеток: c — вдоль стены с входом (0..W−1), r — вглубь от неё (0..D−1); вход — две клетки
 * двери в стене r = −1 (столбцы door, door + 1). front и vendor — покупатель у прилавка и продавец за ним (якоря).
 */
export interface Plan {
  W: number;
  D: number;
  door: number;
  cells: Uint8Array;
  rooms: PlanRoom[];
  fixtures: PlanFixture[];
  front: Spot | null;
  vendor: Spot | null;
  /** Тесная лавка: покупатель у прилавка загораживает вход (как ни ставь — 4 клетки с дверью посередине). */
  tight?: boolean;
}

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/** Детерминированная доля 0..1 по хэшу дома (случайность генератора не тратится — раскладка города не сдвигается). */
const rnd = (h: number, k: number) => hash2(h, k, 0x1a7e) / 4294967296;

/** Порядок перебора по хэшу: у разных домов — разные планы из одного набора вариантов. */
function shuffled<T>(list: T[], h: number, salt: number): T[] {
  return list.map((v, i) => [hash2(h, i, salt), v] as const).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

/**
 * Пешка пройдёт: от входа якорем 2×2 доступна каждая клетка пола и двери плана (иначе генератор засыпал бы её как
 * недоступную; all = false — не проверять) и каждое место must (якорь — левый верхний тайл). Снаружи входа — два ряда
 * улицы.
 */
export function planReachable(cells: Uint8Array, W: number, D: number, door: number, must: readonly Spot[] = [], all = true): boolean {
  const gw = W + 2;
  const gh = D + 4;
  const tiles = new Uint8Array(gw * gh).fill(T.WALL);
  const at = (c: number, r: number) => (r + 3) * gw + (c + 1);
  for (let c = -1; c <= W; c++) {
    tiles[at(c, -3)] = T.STREET;
    tiles[at(c, -2)] = T.STREET;
  }
  tiles[at(door, -1)] = T.DOOR;
  tiles[at(door + 1, -1)] = T.DOOR;
  for (let r = 0; r < D; r++) {
    for (let c = 0; c < W; c++) {
      const v = cells[r * W + c];
      tiles[at(c, r)] = v === CELL.FLOOR ? T.INTERIOR : v === CELL.DOOR ? T.DOOR : v === CELL.FIX ? T.BARRIER : T.WALL;
    }
  }
  const aw = gw - 1;
  const ah = gh - 1;
  const { labels } = labelComponents(buildAnchorWalk(tiles, gw, gh), aw, ah);
  const start = labels[0];
  if (start < 0) return false;
  const ok = (ax: number, ay: number) => ax >= 0 && ay >= 0 && ax < aw && ay < ah && labels[ay * aw + ax] === start;
  for (let r = 0; r < D && all; r++) {
    for (let c = 0; c < W; c++) {
      const v = cells[r * W + c];
      if (v !== CELL.FLOOR && v !== CELL.DOOR) continue;
      const tx = c + 1;
      const ty = r + 3;
      if (!ok(tx - 1, ty - 1) && !ok(tx, ty - 1) && !ok(tx - 1, ty) && !ok(tx, ty)) return false;
    }
  }
  for (const m of must) if (!ok(m.c + 1, m.r + 3)) return false;
  return true;
}

/**
 * Пока пешка стоит на месте stand (её якорь 2×2 занят), от входа доходят до места to: покупатель у прилавка не
 * запирает лавку ни продавцу, ни следующему покупателю, а продавец за прилавком — покупателю.
 */
export function passBy(cells: Uint8Array, W: number, D: number, door: number, stand: Spot, to: Spot): boolean {
  const busy = cells.slice();
  for (let r = stand.r; r <= stand.r + 1; r++) for (let c = stand.c; c <= stand.c + 1; c++) if (c >= 0 && r >= 0 && c < W && r < D) busy[r * W + c] = CELL.FIX;
  return planReachable(busy, W, D, door, [to], false);
}

/**
 * Лавка работает: проходима вся, места покупателя и продавца доступны и (tight = false) ни один из них не запирает
 * другого.
 */
function served(cells: Uint8Array, W: number, D: number, door: number, front: Spot, vendor: Spot, tight = false): boolean {
  if (!planReachable(cells, W, D, door, [front, vendor])) return false;
  return tight || (passBy(cells, W, D, door, front, vendor) && passBy(cells, W, D, door, vendor, front));
}

/**
 * Комнаты-прямоугольники → клетки: между соседними комнатами — стена в клетку; двери (по 2 клетки посередине
 * общего участка стены, не вплотную к другой двери — иначе склеятся в одну) — деревом от входной комнаты entry.
 * Не все комнаты связаны — null.
 */
export function carveRooms(W: number, D: number, door: number, rooms: readonly Box[], entry: number, h: number): Uint8Array | null {
  const cells = new Uint8Array(W * D).fill(CELL.WALL);
  for (const b of rooms) for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) cells[r * W + c] = CELL.FLOOR;
  interface Edge {
    a: number;
    b: number;
    vertical: boolean;
    line: number;
    from: number;
    to: number;
  }
  const edges: Edge[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = 0; j < rooms.length; j++) {
      const A = rooms[i];
      const B = rooms[j];
      if (B.c0 === A.c1 + 2) {
        const from = Math.max(A.r0, B.r0);
        const to = Math.min(A.r1, B.r1);
        if (to - from >= 1) edges.push({ a: i, b: j, vertical: true, line: A.c1 + 1, from, to });
      }
      if (B.r0 === A.r1 + 2) {
        const from = Math.max(A.c0, B.c0);
        const to = Math.min(A.c1, B.c1);
        if (to - from >= 1) edges.push({ a: i, b: j, vertical: false, line: A.r1 + 1, from, to });
      }
    }
  }
  const isDoor = (c: number, r: number) =>
    r === -1 ? c === door || c === door + 1 : c >= 0 && r >= 0 && c < W && r < D && cells[r * W + c] === CELL.DOOR;
  const nearDoor = (c: number, r: number) => isDoor(c - 1, r) || isDoor(c + 1, r) || isDoor(c, r - 1) || isDoor(c, r + 1);
  const seen = rooms.map((_, k) => k === entry);
  const queue = [entry];
  while (queue.length) {
    const u = queue.shift()!;
    const list = shuffled(edges.filter((e) => (e.a === u && !seen[e.b]) || (e.b === u && !seen[e.a])), h, 7 + u);
    for (const e of list) {
      const v = e.a === u ? e.b : e.a;
      if (seen[v]) continue;
      const mid = (e.from + e.to - 1) / 2;
      const spots: number[] = [];
      for (let p = e.from; p < e.to; p++) spots.push(p);
      spots.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
      for (const p of spots) {
        const two = e.vertical ? [[e.line, p], [e.line, p + 1]] : [[p, e.line], [p + 1, e.line]];
        if (two.some(([c, r]) => nearDoor(c, r))) continue;
        for (const [c, r] of two) cells[r * W + c] = CELL.DOOR;
        seen[v] = true;
        queue.push(v);
        break;
      }
    }
  }
  return seen.every(Boolean) ? cells : null;
}

/** План одной комнатой во всё помещение. */
function single(W: number, D: number, door: number, kind: RoomKind): Plan {
  return { W, D, door, cells: new Uint8Array(W * D), rooms: [{ c0: 0, r0: 0, c1: W - 1, r1: D - 1, kind, dwelling: true }], fixtures: [], front: null, vendor: null };
}

/** Вариант раскладки комнат: комнаты и входная (у двери). */
interface Variant {
  rooms: PlanRoom[];
  entry: number;
}

const room = (c0: number, r0: number, c1: number, r1: number, kind: RoomKind, dwelling = false): PlanRoom => ({ c0, r0, c1, r1, kind, dwelling });

/** Промежуток [a, b] на n частей через стену в клетку, каждая не меньше min; не влезает — null. */
function splitSpan(a: number, b: number, n: number, min: number): [number, number][] | null {
  const len = b - a + 1;
  const free = len - (n - 1);
  if (n < 1 || free < n * min) return null;
  const out: [number, number][] = [];
  let s = a;
  for (let k = 0; k < n; k++) {
    const size = Math.floor(free / n) + (k < free % n ? 1 : 0);
    out.push([s, s + size - 1]);
    s += size + 1;
  }
  return out;
}

/**
 * Слобода. Коммуналка: от двери вглубь — коридор, по бокам — комнаты (каждая — своё жильё), из трёх и больше одна —
 * общая кухня. Узкий дом — кухня у двери и комната за стеной.
 */
function slumVariants(W: number, D: number, door: number): Variant[] {
  const H = INTERIORS.home;
  const out: Variant[] = [];
  const hasL = door - 1 >= H.room;
  const hasR = W - door - 3 >= H.room;
  if (W >= H.communal && (hasL || hasR)) {
    const rooms: PlanRoom[] = [room(hasL ? door : 0, 0, hasR ? door + 1 : W - 1, D - 1, 'corridor')];
    const blocks: [number, number][] = [];
    if (hasL) blocks.push([0, door - 2]);
    if (hasR) blocks.push([door + 3, W - 1]);
    for (const [c0, c1] of blocks) {
      // Комнаты вглубь — не мельче roomDepth + 1 рядов (кровать вдоль стены и проход).
      let parts: [number, number][] | null = null;
      for (let n = 3; n >= 1 && !parts; n--) parts = splitSpan(0, D - 1, n, H.roomDepth + 1);
      for (const [r0, r1] of parts ?? []) rooms.push(room(c0, r0, c1, r1, 'room', true));
    }
    const living = rooms.filter((r) => r.kind === 'room');
    // Широкий коридор (без комнат с одной стороны) — общая кухня; иначе из трёх и больше комнат одна — кухня.
    if (rooms[0].c1 - rooms[0].c0 + 1 >= 4) rooms[0].kind = 'kitchen';
    else if (living.length >= 3) {
      // Общая кухня — самая маленькая из комнат.
      const k = living.reduce((a, b) => ((b.c1 - b.c0 + 1) * (b.r1 - b.r0 + 1) < (a.c1 - a.c0 + 1) * (a.r1 - a.r0 + 1) ? b : a));
      k.kind = 'kitchen';
      k.dwelling = false;
    }
    if (living.length) out.push({ rooms, entry: 0 });
  }
  if (D >= 2 + 1 + H.roomDepth + 1) {
    const f = D >= H.deep ? H.frontDeep : H.front;
    out.push({ rooms: [room(0, 0, W - 1, f - 1, 'kitchen'), room(0, f + 1, W - 1, D - 1, 'bedroom')], entry: 0 });
  }
  return out;
}

/**
 * Старый и Верхний город: прихожая у двери, по бокам — кухня и санузел, за стеной — одна или две комнаты (гостиная и
 * спальня); узкий дом — кухня у двери и комнаты вглубь. upper — две комнаты всегда, когда помещаются.
 */
function flatVariants(W: number, D: number, door: number, upper: boolean, h: number): Variant[] {
  const H = INTERIORS.home;
  const out: Variant[] = [];
  const f = D >= H.deep ? H.frontDeep : H.front;
  const back0 = f + 1;
  if (D - back0 < H.roomDepth) return out;
  const hasL = W >= 6 && door - 1 >= H.side;
  const hasR = W >= 6 && W - door - 3 >= H.side;
  const front: PlanRoom[] = [room(hasL ? door : 0, 0, hasR ? door + 1 : W - 1, f - 1, hasL || hasR ? 'hall' : 'kitchen')];
  const sides: PlanRoom[] = [];
  if (hasL) sides.push(room(0, 0, door - 2, f - 1, 'kitchen'));
  if (hasR) sides.push(room(door + 3, 0, W - 1, f - 1, 'kitchen'));
  // Две боковые — кухня побольше, санузел поменьше.
  if (sides.length === 2) {
    const [a, b] = sides;
    (a.c1 - a.c0 >= b.c1 - b.c0 ? b : a).kind = 'bath';
  }
  const two: number[] = [];
  if (W >= H.backSplit && (upper || rnd(h, 1) < H.oldSplit)) for (let q = H.room; q <= W - 1 - H.room; q++) two.push(q);
  for (const q of shuffled(two, h, 3)) {
    const a = room(0, back0, q - 1, D - 1, 'living');
    const b = room(q + 1, back0, W - 1, D - 1, 'living');
    (a.c1 - a.c0 >= b.c1 - b.c0 ? b : a).kind = 'bedroom';
    out.push({ rooms: [...front, ...sides, a, b], entry: 0 });
  }
  out.push({ rooms: [...front, ...sides, room(0, back0, W - 1, D - 1, 'bedroom')], entry: 0 });
  return out;
}

/**
 * Жильё W × D с дверью в столбцах door, door + 1 — по полосе достатка: Слобода — хибара или коммуналка, Старый и
 * Верхний город — студия или квартира. Первый проходимый вариант; ни один — одна комната.
 */
export function planHome(W: number, D: number, door: number, district: District | null, h: number): Plan {
  const H = INTERIORS.home;
  if (W < 2 || D < 2 || W * D < H.studio) return single(W, D, door, 'studio');
  const variants = district === 'slum' ? slumVariants(W, D, door) : flatVariants(W, D, door, district === 'upper', h);
  for (const v of variants) {
    const cells = carveRooms(W, D, door, v.rooms, v.entry, h);
    if (cells && planReachable(cells, W, D, door)) return { W, D, door, cells, rooms: v.rooms, fixtures: [], front: null, vendor: null };
  }
  return single(W, D, door, 'studio');
}

/** Клетки оборудования b: пол, не занятые reserved, внутри зала (room). */
function fits(p: Plan, b: Box, hall: Box, reserved: Uint8Array): boolean {
  if (b.c0 < hall.c0 || b.r0 < hall.r0 || b.c1 > hall.c1 || b.r1 > hall.r1) return false;
  for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) if (p.cells[r * p.W + c] !== CELL.FLOOR || reserved[r * p.W + c]) return false;
  return true;
}

/** Длина оборудования вида kind (у стены / посередине): примерочная и стойка — 2, зеркало и столик — 1. */
function lengthsOf(kind: string, where: 'wall' | 'island'): number[] {
  const S = INTERIORS.shop;
  if (kind === 'mirror' || kind === 'table') return [1];
  if (kind === 'booth' || kind === 'stand' || kind === 'case') return [2];
  const [a, b] = where === 'wall' ? S.wallLen : S.islandLen;
  const out: number[] = [];
  for (let n = b; n >= a; n--) out.push(n);
  return out;
}

/**
 * Зал: оборудование по списку INTERIORS.shop.fit вида лавки — у стен зала (кроме фасада: там витрины) и
 * посередине (вокруг — проход), пока помещается; каждое — только если пешка по-прежнему доходит до каждой клетки, до
 * покупателя и продавца. Столик кафе — с местом для стульев вокруг.
 */
function pack(p: Plan, sub: string, hall: Box, reserved: Uint8Array, h: number): void {
  const S = INTERIORS.shop;
  const list = S.fit[sub] ?? [];
  const must = [p.front, p.vendor].filter((s): s is Spot => !!s);
  const count = new Map<string, number>();
  const wall = (c: number, r: number) => c < 0 || r < 0 || c >= p.W || r >= p.D || p.cells[r * p.W + c] === CELL.WALL;
  list.forEach(([kind, where], k) => {
    if ((count.get(kind) ?? 0) >= (S.max[kind] ?? 1)) return;
    const cands: PlanFixture[] = [];
    for (const len of lengthsOf(kind, where)) {
      for (let r = hall.r0; r <= hall.r1; r++) {
        for (let c = hall.c0; c <= hall.c1; c++) {
          for (const horiz of [true, false]) {
            if (len === 1 && !horiz && where === 'island') continue;
            const b: Box = horiz ? { c0: c, r0: r, c1: c + len - 1, r1: r } : { c0: c, r0: r, c1: c, r1: r + len - 1 };
            if (b.c1 >= p.W || b.r1 >= p.D) continue;
            if (where === 'wall') {
              // Вплотную к стене вдоль длинной стороны; не у фасада (r = 0 вдоль входной стены — там витрины).
              let face: Side | null = null;
              if (horiz && b.r1 === p.D - 1 && wall(c, b.r1 + 1)) face = 0;
              else if (horiz && b.r0 > 0) {
                let up = true;
                for (let x = b.c0; x <= b.c1; x++) if (!wall(x, b.r0 - 1)) up = false;
                if (up && b.r0 - 1 >= 0) face = 2;
              }
              if (face === null && !horiz) {
                let left = true;
                let right = true;
                for (let y = b.r0; y <= b.r1; y++) {
                  if (!wall(b.c0 - 1, y)) left = false;
                  if (!wall(b.c1 + 1, y)) right = false;
                }
                if (left) face = 1;
                else if (right) face = 3;
              }
              if (face === null) continue;
              cands.push({ ...b, kind: kind as PlanFixture['kind'], face });
            } else {
              // Посередине: вокруг — пол (не стена, не оборудование).
              let ring = true;
              for (let y = b.r0 - 1; y <= b.r1 + 1 && ring; y++) {
                for (let x = b.c0 - 1; x <= b.c1 + 1; x++) {
                  if (x >= b.c0 && x <= b.c1 && y >= b.r0 && y <= b.r1) continue;
                  if (x < 0 || y < 0 || x >= p.W || y >= p.D || p.cells[y * p.W + x] !== CELL.FLOOR) {
                    ring = false;
                    break;
                  }
                }
              }
              if (!ring) continue;
              cands.push({ ...b, kind: kind as PlanFixture['kind'], face: horiz ? 0 : 1 });
            }
          }
        }
      }
    }
    for (const f of shuffled(cands, h, 101 + k)) {
      if (!fits(p, f, hall, reserved)) continue;
      for (let r = f.r0; r <= f.r1; r++) for (let c = f.c0; c <= f.c1; c++) p.cells[r * p.W + c] = CELL.FIX;
      if (p.front && p.vendor ? served(p.cells, p.W, p.D, p.door, p.front, p.vendor, p.tight) : planReachable(p.cells, p.W, p.D, p.door, must)) {
        p.fixtures.push(f);
        count.set(kind, (count.get(kind) ?? 0) + 1);
        return;
      }
      for (let r = f.r0; r <= f.r1; r++) for (let c = f.c0; c <= f.c1; c++) p.cells[r * p.W + c] = CELL.FLOOR;
    }
  });
}

/** Занять клетки якоря s (2×2) в reserved. */
function reserve(reserved: Uint8Array, W: number, D: number, s: Spot, grow = 0): void {
  for (let r = s.r - grow; r <= s.r + 1 + grow; r++) for (let c = s.c - grow; c <= s.c + 1 + grow; c++) if (c >= 0 && r >= 0 && c < W && r < D) reserved[r * W + c] = 1;
}

/**
 * Прилавок поперёк: ряд kc во всю ширину, кроме прохода в 2 клетки у края (left — слева), покупатель перед
 * серединой, продавец за ней; backroom — подсобка (у кафе — кухня) за стеной через ряд от продавца.
 */
function backCounter(W: number, D: number, door: number, sub: string, left: boolean, backroom: boolean, h: number, tight: boolean): Plan | null {
  const S = INTERIORS.shop;
  const cafe = sub === 'cafe' || sub === 'coffee';
  const deep = backroom && D >= S.backroom;
  const kc = deep ? D - 6 : D - 3;
  if (kc < 2 || W < 4) return null;
  const hall = room(0, 0, W - 1, deep ? kc + 2 : D - 1, cafe ? 'cafe' : 'sales');
  const rooms: PlanRoom[] = [hall];
  if (deep) rooms.push(room(0, kc + 4, W - 1, D - 1, cafe ? 'cafe_kitchen' : 'backroom'));
  const cells = carveRooms(W, D, door, rooms, 0, h);
  if (!cells) return null;
  const c0 = left ? 2 : 0;
  const c1 = left ? W - 1 : W - 3;
  for (let c = c0; c <= c1; c++) cells[kc * W + c] = CELL.FIX;
  // Покупатель и продавец — друг против друга у прилавка: ближе к середине, где ни один не запирает другого.
  const mid = Math.max(c0, Math.min(c1 - 1, Math.round((c0 + c1 - 1) / 2)));
  const cols: number[] = [];
  for (let c = c0; c < c1; c++) cols.push(c);
  const cf = cols.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)).find((c) => served(cells, W, D, door, { c, r: kc - 2 }, { c, r: kc + 1 }, tight));
  if (cf === undefined) return null;
  const p: Plan = {
    W, D, door, cells, rooms, fixtures: [{ c0, r0: kc, c1, r1: kc, kind: (S.counter[sub] ?? 'counter') as PlanFixture['kind'], face: 0 }],
    front: { c: cf, r: kc - 2 }, vendor: { c: cf, r: kc + 1 }, tight,
  };
  const reserved = new Uint8Array(W * D);
  reserve(reserved, W, D, { c: door, r: 0 });
  reserve(reserved, W, D, p.front!);
  pack(p, sub, { c0: 0, r0: 0, c1: W - 1, r1: kc - 1 }, reserved, h);
  return p;
}

/**
 * Касса у боковой стены у входа (самообслуживание, салон): стойка в столбце в 3 клетках от стены на desk клеток от
 * фасада, продавец между ней и стеной, покупатель — перед ней; в зале — стеллажи, холодильник, вешалки. right — касса
 * у стены c = W − 1; вход не за кассой и не перед ней.
 */
function sideDesk(W: number, D: number, door: number, sub: string, right: boolean, h: number, tight: boolean): Plan | null {
  const S = INTERIORS.shop;
  if (W < S.selfMin || D < 5) return null;
  const cc = right ? W - 3 : 2;
  if (right ? door + 1 >= cc : door <= cc) return null;
  const L = Math.min(S.desk, D - 2);
  const cells = new Uint8Array(W * D);
  for (let r = 0; r < L; r++) cells[r * W + cc] = CELL.FIX;
  // Покупатель — у кассы (у её конца, а если там он запер бы вход — глубже или ближе к фасаду).
  const vendor: Spot = { c: right ? cc + 1 : 0, r: L - 2 };
  const rows = [L - 2, L - 1, ...Array.from({ length: Math.max(0, L - 2) }, (_, k) => L - 3 - k)];
  const rf = rows.find((r) => served(cells, W, D, door, { c: right ? cc - 2 : cc + 1, r }, vendor, tight));
  if (rf === undefined) return null;
  const p: Plan = {
    W, D, door, cells, rooms: [room(0, 0, W - 1, D - 1, 'sales')],
    fixtures: [{ c0: cc, r0: 0, c1: cc, r1: L - 1, kind: 'counter', face: right ? 3 : 1 }],
    front: { c: right ? cc - 2 : cc + 1, r: rf }, vendor, tight,
  };
  const reserved = new Uint8Array(W * D);
  reserve(reserved, W, D, { c: door, r: 0 });
  reserve(reserved, W, D, p.front!);
  // Место продавца и проход к нему из-за кассы.
  for (let r = 0; r <= L + 1 && r < D; r++) for (let c = right ? cc : 0; c <= (right ? W - 1 : cc); c++) reserved[r * W + c] = 1;
  pack(p, sub, { c0: 0, r0: 0, c1: W - 1, r1: D - 1 }, reserved, h);
  return p;
}

/**
 * Лавка или кафе W × D с дверью в столбцах door, door + 1 (sub — вид, INTERIORS.shop): самообслуживание и салон —
 * касса сбоку, остальные — прилавок поперёк (в глубокой — с подсобкой или кухней); left — проход в прилавке слева
 * (так генератор тратит свою случайность, как раньше). Ни один вариант не проходим — null.
 */
export function planShop(W: number, D: number, door: number, sub: string, left: boolean, h: number): Plan | null {
  const S = INTERIORS.shop;
  const variants: ((tight: boolean) => Plan | null)[] = [];
  if (S.self.includes(sub) || S.salon.includes(sub)) {
    variants.push((t) => sideDesk(W, D, door, sub, !left, h, t));
    variants.push((t) => sideDesk(W, D, door, sub, left, h, t));
  }
  // Проход в прилавке — с выпавшей стороны, а не вышло (покупатель запер бы вход) — с другой.
  if (S.withBackroom.includes(sub)) variants.push((t) => backCounter(W, D, door, sub, left, true, h, t), (t) => backCounter(W, D, door, sub, !left, true, h, t));
  variants.push((t) => backCounter(W, D, door, sub, left, false, h, t), (t) => backCounter(W, D, door, sub, !left, false, h, t));
  // Сперва — где покупатель у прилавка не запирает лавку; в тесной (4 клетки, дверь посередине) так не выходит —
  // тогда как в прежней лавке: пока покупатель у прилавка, вход загорожен.
  for (const tight of [false, true]) {
    for (const v of variants) {
      const p = v(tight);
      if (p) return p;
    }
  }
  return null;
}

/** Направление стороны плана: смещение клетки (dc, dr). */
export function sideStep(s: Side): [number, number] {
  return [DX[s], DY[s]];
}
