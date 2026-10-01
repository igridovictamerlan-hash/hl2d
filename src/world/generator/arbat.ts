import type { Rng } from '../../core/rng';
import type { Rect } from '../../core/math';
import { GENERATOR } from '../../config/generator';
import { ARBAT } from '../../config/arbat';
import { T, SOLID } from '../tiles';
import type { FacadeUse, Poi, ZoneKind } from '../GameMap';
import type { GenGrid } from './GenGrid';
import { avenueSegAt, type Avenue } from './layout';
import type { Lattice } from './lattice';

/**
 * Улица старого города: вдоль проспектов, площади и улиц-артерий — сплошной ряд домов, у каждого
 * свой фасад и дверь на улицу. Переулки, выходящие на улицу, — промежутки между домами. На главном
 * проспекте и площади — лавки, кафе и общая столовая (напротив площади), посередине проспекта —
 * ларьки и клумбы.
 */

type Face = 'N' | 'S' | 'E' | 'W';

/** Улица, вдоль которой ставится ряд домов: u — вдоль улицы, v — поперёк; out — от улицы к домам. */
export interface Frontage {
  horizontal: boolean;
  out: -1 | 1;
  u0: number;
  u1: number;
  /** Ряд стены дома, примыкающий к улице, в столбце u (null — улицы тут нет). */
  front: (u: number) => number | null;
  street: 'avenue' | 'plaza' | 'artery';
  /** Главный проспект или площадь: здесь лавки, кафе и столовая, на остальных — жилые дома. */
  main: boolean;
}

export interface FacadeBuilding {
  id: number;
  rect: Rect;
  interior: Rect;
  face: Face;
  use: FacadeUse;
  sub?: string;
  fr: Frontage;
  /** Столбцы дома вдоль улицы, ряд фасада, ближайший к комнате, и задняя стена. */
  ua: number;
  ub: number;
  fIn: number;
  back: number;
}

/** Глубина полосы домов от края проспекта (самый глубокий дом). */
export function facadeDepthMax(): number {
  const F = GENERATOR.facades;
  return Math.max(F.depth[1], F.canteen.depth[1]);
}

/**
 * Переулки, выходящие на проспект, пересекают ряд домов прямо: излом (Z) ребра решётки от узла
 * проспекта — только за полосой домов. line — индекс линии решётки проспекта.
 */
export function constrainAvenueLanes(lat: Lattice, av: Avenue, line: number): void {
  const D = facadeDepthMax() + 1;
  const mw = GENERATOR.alley.mainWidth;
  const span = (a: number, b: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let p = a; p <= b; p++) {
      const s = avenueSegAt(av, p);
      lo = Math.min(lo, s.offset);
      hi = Math.max(hi, s.offset + s.width);
    }
    return { lo, hi };
  };
  if (av.horizontal) {
    for (let i = 0; i < lat.cols; i++) {
      const up = lat.vEdge(i, line - 1);
      if (up) {
        const A = lat.nodes[up.a];
        const B = lat.nodes[up.b];
        const w = up.artery ? up.width : mw;
        up.kinkMax = span(Math.min(A.x, B.x), Math.max(A.x, B.x) + w - 1).lo - D - w;
      }
      const down = lat.vEdge(i, line);
      if (down) {
        const A = lat.nodes[down.a];
        const B = lat.nodes[down.b];
        const w = down.artery ? down.width : mw;
        down.kinkMin = span(Math.min(A.x, B.x), Math.max(A.x, B.x) + w - 1).hi + D;
      }
    }
  } else {
    for (let j = 0; j < lat.rows; j++) {
      const left = lat.hEdge(line - 1, j);
      if (left) {
        const A = lat.nodes[left.a];
        const B = lat.nodes[left.b];
        const w = left.artery ? left.width : mw;
        left.kinkMax = span(Math.min(A.y, B.y), Math.max(A.y, B.y) + w - 1).lo - D - w;
      }
      const right = lat.hEdge(line, j);
      if (right) {
        const A = lat.nodes[right.a];
        const B = lat.nodes[right.b];
        const w = right.artery ? right.width : mw;
        right.kinkMin = span(Math.min(A.y, B.y), Math.max(A.y, B.y) + w - 1).hi + D;
      }
    }
  }
}

/** Две стороны проспекта. main — главный (лавки и столовая). */
export function avenueFrontages(av: Avenue, main: boolean): Frontage[] {
  const u0 = av.segs[0].from;
  const u1 = av.segs[av.segs.length - 1].to;
  return [-1, 1].map((out) => ({
    horizontal: av.horizontal,
    out: out as -1 | 1,
    u0,
    u1,
    front: (u: number) => {
      const s = avenueSegAt(av, u);
      return out < 0 ? s.offset - 1 : s.offset + s.width;
    },
    street: 'avenue' as const,
    main,
  }));
}

/** Стороны прямоугольника улицы или площади (skip — сторона, где её нет: проспект у площади). */
export function rectFrontages(r: Rect, street: Frontage['street'], main: boolean, skip: Face | null = null): Frontage[] {
  const out: Frontage[] = [];
  const add = (horizontal: boolean, o: -1 | 1, u0: number, u1: number, f: number) =>
    out.push({ horizontal, out: o, u0, u1, front: () => f, street, main });
  if (skip !== 'N') add(true, -1, r.x, r.x + r.w - 1, r.y - 1);
  if (skip !== 'S') add(true, 1, r.x, r.x + r.w - 1, r.y + r.h);
  if (skip !== 'W') add(false, -1, r.y, r.y + r.h - 1, r.x - 1);
  if (skip !== 'E') add(false, 1, r.y, r.y + r.h - 1, r.x + r.w);
  return out;
}

/** Куски артерий: прямые отрезки длиннее minLen — обе стороны. */
export function arteryFrontages(rects: readonly Rect[], width: number, minLen = 6): Frontage[] {
  const out: Frontage[] = [];
  for (const r of rects) {
    if (r.h === width && r.w >= minLen) {
      out.push(...rectFrontages(r, 'artery', false).filter((f) => f.horizontal));
    } else if (r.w === width && r.h >= minLen) {
      out.push(...rectFrontages(r, 'artery', false).filter((f) => !f.horizontal));
    }
  }
  return out;
}

export interface FacadeOptions {
  frontages: Frontage[];
  /** Центр площади раздачи (тайлы): столовая — напротив, лавки — ближе к ней. */
  plazaCenter: { x: number; y: number } | null;
  addZone: (kind: ZoneKind, name: string) => number;
  pois: Poi[];
}

/**
 * Ставит ряды домов вдоль улиц. Сперва столовая (главный проспект, ближе к площади), потом дома
 * по всем улицам, потом из домов главного проспекта и площади — лавки и кафе. Возвращает дома.
 */
export function buildFacades(g: GenGrid, rng: Rng, o: FacadeOptions): FacadeBuilding[] {
  const F = GENERATOR.facades;
  const out: FacadeBuilding[] = [];
  const at = (fr: Frontage, u: number, v: number) => (fr.horizontal ? { x: u, y: v } : { x: v, y: u });
  const tile = (fr: Frontage, u: number, v: number) => {
    const p = at(fr, u, v);
    return g.get(p.x, p.y);
  };
  const free = (fr: Frontage, u: number, v: number) => {
    const p = at(fr, u, v);
    return g.inside(p.x, p.y) && g.get(p.x, p.y) === T.WALL && !g.isLocked(p.x, p.y);
  };
  /** Столбец u годится под дом: у фасада улица, вглубь depth тайлов — свободная застройка. */
  const colOk = (fr: Frontage, u: number, depth: number): boolean => {
    const f = fr.front(u);
    if (f === null) return false;
    const st = tile(fr, u, f - fr.out);
    if (st !== T.STREET && st !== T.PLAZA) return false;
    for (let d = 0; d < depth; d++) if (!free(fr, u, f + fr.out * d)) return false;
    return true;
  };
  const runs = (fr: Frontage, depth: number): [number, number][] => {
    const res: [number, number][] = [];
    let s = -1;
    for (let u = fr.u0; u <= fr.u1 + 1; u++) {
      const ok = u <= fr.u1 && colOk(fr, u, depth);
      if (ok && s < 0) s = u;
      if (!ok && s >= 0) {
        res.push([s, u - 1]);
        s = -1;
      }
    }
    return res;
  };
  const faceOf = (fr: Frontage): Face => (fr.horizontal ? (fr.out < 0 ? 'S' : 'N') : fr.out < 0 ? 'E' : 'W');

  /** Дом в столбцах ua..ub глубиной из depth (уменьшается до minDepth, если упирается). */
  const place = (fr: Frontage, ua: number, ub: number, depth: readonly [number, number], minDepth: number): FacadeBuilding | null => {
    const fronts: number[] = [];
    for (let u = ua; u <= ub; u++) fronts.push(fr.front(u)!);
    const fIn = fr.out < 0 ? Math.min(...fronts) : Math.max(...fronts);
    const fits = (d: number) => {
      const back = fIn + fr.out * (d - 1);
      for (let u = ua; u <= ub; u++) {
        const f = fronts[u - ua];
        for (let v = f; v !== back + fr.out; v += fr.out) if (!free(fr, u, v)) return false;
      }
      return true;
    };
    let d = rng.int(depth[0], depth[1]);
    while (d >= minDepth && !fits(d)) d--;
    if (d < minDepth) return null;
    const back = fIn + fr.out * (d - 1);
    // Комната: между боковыми стенами, от фасада (ближнего к комнате ряда) до задней стены.
    for (let u = ua + 1; u <= ub - 1; u++) {
      for (let v = fIn + fr.out; v !== back; v += fr.out) {
        const p = at(fr, u, v);
        g.set(p.x, p.y, T.INTERIOR);
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let u = ua; u <= ub; u++) {
      for (const v of [fronts[u - ua], back]) {
        const p = at(fr, u, v);
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
    const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const i0 = at(fr, ua + 1, fIn + fr.out);
    const i1 = at(fr, ub - 1, back - fr.out);
    const interior = { x: Math.min(i0.x, i1.x), y: Math.min(i0.y, i1.y), w: Math.abs(i1.x - i0.x) + 1, h: Math.abs(i1.y - i0.y) + 1 };
    // Весь дом (со ступенькой фасада) — заблокирован: детали застройки и тоннели его не трогают.
    for (let u = ua; u <= ub; u++) {
      for (let v = fronts[u - ua]; v !== back + fr.out; v += fr.out) {
        const p = at(fr, u, v);
        g.locked[p.y * g.w + p.x] = 1;
      }
    }
    return { id: out.length, rect, interior, face: faceOf(fr), use: 'house', fr, ua, ub, fIn, back };
  };

  // 1. Столовая: на главном проспекте, почти прямой кусок фасада (ступеньки до 2 тайлов) ближе к площади.
  const C = F.canteen;
  const pc = o.plazaCenter;
  {
    const best: { fr: Frontage | null; a: number; b: number } = { fr: null, a: 0, b: 0 };
    let bestD = Infinity;
    const want = rng.int(C.width[0], C.width[1]);
    for (const fr of o.frontages) {
      if (!fr.main || fr.street !== 'avenue') continue;
      for (const [a, b] of runs(fr, C.depth[0])) {
        for (let wdt = want; wdt >= C.width[0]; wdt--) {
          for (let s = a; s + wdt - 1 <= b; s++) {
            let lo = Infinity, hi = -Infinity;
            for (let u = s; u < s + wdt; u++) {
              const f = fr.front(u)!;
              lo = Math.min(lo, f);
              hi = Math.max(hi, f);
            }
            if (hi - lo > 2) continue;
            const mid = at(fr, s + (wdt >> 1), fr.front(s + (wdt >> 1))!);
            const dist = pc ? Math.hypot(mid.x - pc.x, mid.y - pc.y) : 0;
            if (dist < bestD) {
              bestD = dist;
              best.fr = fr;
              best.a = s;
              best.b = s + wdt - 1;
            }
          }
          if (best.fr === fr) break;
        }
      }
    }
    const b = best.fr ? place(best.fr, best.a, best.b, C.depth, C.depth[0]) : null;
    if (b) {
      b.use = 'canteen';
      out.push(b);
    }
  }

  // 2. Ряды домов: куски шириной width, по участкам фасада (где фасад сдвигается — новый дом);
  // обрезки уже minWidth отходят соседу (фасад со ступенькой).
  for (const fr of o.frontages) {
    const A = fr.street === 'artery' ? F.artery : F;
    for (const [a, b] of runs(fr, F.minDepth)) {
      if (b - a + 1 < F.minWidth) continue;
      const pieces: [number, number][] = [];
      let s = a;
      while (s <= b) {
        let e = s;
        while (e < b && fr.front(e + 1) === fr.front(s)) e++;
        const want = rng.int(A.width[0], A.width[1]);
        if (e - s + 1 > A.width[1]) e = s + want - 1;
        if (e - s + 1 < F.minWidth) e = Math.min(b, s + F.minWidth - 1);
        if (b - e < F.minWidth) e = b;
        pieces.push([s, e]);
        s = e + 1;
      }
      for (const [pa, pb] of pieces) {
        const bld = place(fr, pa, pb, A.depth, F.minDepth);
        if (bld) out.push(bld);
      }
    }
  }

  // 3. Лавки и кафе — из домов главного проспекта и площади, ближе к площади, не вплотную друг к другу.
  const shopDepth = F.counterRow + 3;
  const inDepth = (b: FacadeBuilding) => Math.abs(b.back - b.fIn) - 1;
  const inWidth = (b: FacadeBuilding) => b.ub - b.ua - 1;
  const dist = (b: FacadeBuilding) => (pc ? Math.hypot(b.rect.x + b.rect.w / 2 - pc.x, b.rect.y + b.rect.h / 2 - pc.y) : 0);
  const cands = out.filter((b) => b.fr.main && b.use === 'house').sort((p, q) => dist(p) - dist(q));
  const taken: FacadeBuilding[] = out.filter((b) => b.use !== 'house');
  const neighbour = (b: FacadeBuilding) => taken.some((t) => t.fr === b.fr && (t.ub + 2 >= b.ua && t.ua - 2 <= b.ub));
  const pick = (ok: (b: FacadeBuilding) => boolean): FacadeBuilding | null => {
    const b = cands.find((c) => c.use === 'house' && ok(c) && !neighbour(c)) ?? cands.find((c) => c.use === 'house' && ok(c));
    if (b) taken.push(b);
    return b ?? null;
  };
  for (const def of ARBAT.shops) {
    const b = pick((c) => inDepth(c) >= shopDepth && inWidth(c) >= 4);
    if (!b) break;
    b.use = 'shop';
    b.sub = def.id;
  }
  for (const def of ARBAT.cafes.slice(0, F.cafes)) {
    const b = pick((c) => inDepth(c) >= 6 && inWidth(c) >= 6);
    if (!b) break;
    b.use = 'cafe';
    b.sub = def.id;
  }

  // 4. Двери, прилавки, столы, зоны и точки интереса.
  for (const b of out) finish(g, rng, b, o);
  return out;
}

/** Двери на улицу, убранство по назначению, зона и точки интереса одного дома. */
function finish(g: GenGrid, rng: Rng, b: FacadeBuilding, o: FacadeOptions): void {
  const F = GENERATOR.facades;
  const fr = b.fr;
  const at = (u: number, v: number) => (fr.horizontal ? { x: u, y: v } : { x: v, y: u });
  /** Тайл комнаты: c — столбец от ua+1, k — ряд от фасада (0 — у двери). */
  const cell = (c: number, k: number) => at(b.ua + 1 + c, b.fIn + fr.out * (1 + k));
  const iw = b.ub - b.ua - 1;
  const id = Math.abs(b.back - b.fIn) - 1;
  // Двери (2 тайла) — где фасад у самой комнаты; у столовой — две.
  const spots: number[] = [];
  for (let u = b.ua + 1; u <= b.ub - 2; u++) if (fr.front(u) === b.fIn && fr.front(u + 1) === b.fIn) spots.push(u);
  const mid = (b.ua + b.ub) / 2 - 0.5;
  const doorAt = (u: number) => {
    for (const x of [u, u + 1]) {
      const f = fr.front(x)!;
      // Фасад со ступенькой: в толстой стене — входная ниша с улицы, дверь — у самой комнаты.
      const st = at(x, f - fr.out);
      const zone = g.zones[st.y * g.w + st.x];
      for (let v = f; v !== b.fIn; v += fr.out) {
        const q = at(x, v);
        g.set(q.x, q.y, T.STREET, true);
        g.zones[q.y * g.w + q.x] = zone;
      }
      const p = at(x, b.fIn);
      g.set(p.x, p.y, T.DOOR, true);
    }
  };
  const doors: number[] = [];
  if (spots.length === 0) {
    // Фасад весь со ступенькой — дверь посередине сквозь толстую стену.
    doors.push(Math.max(b.ua + 1, Math.min(b.ub - 2, Math.round(mid))));
  } else if (b.use === 'house') {
    doors.push(rng.pick(spots));
  } else if (b.use === 'canteen' && iw >= 12) {
    for (const t of [1 / 4, 3 / 4]) {
      const want = b.ua + (b.ub - b.ua) * t - 0.5;
      doors.push(spots.reduce((p, q) => (Math.abs(q - want) < Math.abs(p - want) ? q : p)));
    }
  } else {
    doors.push(spots.reduce((p, q) => (Math.abs(q - mid) < Math.abs(p - mid) ? q : p)));
  }
  for (const u of doors) doorAt(u);
  const doorCols = new Set(doors.flatMap((u) => [u - b.ua - 1, u - b.ua]));
  const def = (list: readonly { id: string; name: string }[]) => list.find((d) => d.id === b.sub);
  const zoneOver = (zone: number) => {
    for (let u = b.ua; u <= b.ub; u++) {
      for (let v = fr.front(u)!; v !== b.back + fr.out; v += fr.out) {
        const p = at(u, v);
        g.zones[p.y * g.w + p.x] = zone;
      }
    }
  };
  const pt = (c: number, k: number) => cell(Math.max(0, Math.min(iw - 1, c)), Math.max(0, Math.min(id - 1, k)));
  const barrier = (c: number, k: number) => {
    const p = cell(c, k);
    g.set(p.x, p.y, T.BARRIER, true);
  };
  /** Прилавок в ряду k во всю ширину, кроме прохода в 2 тайла у одного края. */
  const counter = (k: number) => {
    const gapLeft = rng.chance(0.5);
    for (let c = 0; c < iw; c++) if (gapLeft ? c >= 2 : c < iw - 2) barrier(c, k);
  };
  const tileRect = (c0: number, k0: number, c1: number, k1: number): Rect => {
    const p = cell(c0, k0);
    const q = cell(c1, k1);
    return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x) + 1, h: Math.abs(q.y - p.y) + 1 };
  };
  const cm = iw >> 1;
  switch (b.use) {
    case 'house':
      o.pois.push({ type: 'home', ...b.interior });
      break;
    case 'shop': {
      const d = def(ARBAT.shops);
      zoneOver(o.addZone('shop', d?.name ?? 'Лавка'));
      const k = F.counterRow;
      counter(k);
      const front = pt(cm, k - 1);
      o.pois.push({ type: 'shop_front', ...front, id: b.id, sub: b.sub });
      o.pois.push({ type: 'vendor_spot', ...pt(cm, k + 1), id: b.id, sub: b.sub });
      if (b.sub === 'cwu') o.pois.push({ type: 'shop_counter', ...front });
      break;
    }
    case 'cafe': {
      const d = def(ARBAT.cafes);
      zoneOver(o.addZone('shop', d?.name ?? 'Кафе'));
      const k = id - 3;
      counter(k);
      o.pois.push({ type: 'shop_front', ...pt(cm, k - 1), id: b.id, sub: b.sub });
      o.pois.push({ type: 'vendor_spot', ...pt(cm, k + 1), id: b.id, sub: b.sub });
      // Столики — в зале посетителей, не напротив двери.
      if (k >= 3) {
        for (let c = 1; c < iw - 1; c += 3) {
          if (doorCols.has(c) || doorCols.has(c - 1) || doorCols.has(c + 1)) continue;
          const p = cell(c, 1);
          o.pois.push({ type: 'cafe_table', x: p.x, y: p.y, w: 1, h: 1, id: b.id });
        }
      }
      break;
    }
    case 'canteen': {
      zoneOver(o.addZone('canteen', ARBAT.canteen.name));
      // С заднего края: кухня (2 ряда), раздача, проход (2), столы, места и вход.
      const kCounter = id - 3;
      counter(kCounter);
      const kTable = kCounter - 3;
      const C = F.canteen;
      for (let c = 2; c + C.tableLen[0] <= iw - 2; ) {
        const len = Math.min(rng.int(C.tableLen[0], C.tableLen[1]), iw - 2 - c);
        for (let t = 0; t < len; t++) barrier(c + t, kTable);
        o.pois.push({ type: 'canteen_table', ...tileRect(c, kTable, c + len - 1, kTable), id: b.id });
        c += len + 2;
      }
      o.pois.push({ type: 'canteen', ...b.interior, id: b.id });
      o.pois.push({ type: 'canteen_serve', ...pt(cm, kCounter - 1), id: b.id });
      o.pois.push({ type: 'canteen_cook', ...pt(cm, kCounter + 1), id: b.id });
      break;
    }
  }
  o.pois.push({ type: 'facade', ...b.rect, id: b.id, face: b.face, use: b.use, sub: b.sub });
}

/**
 * Середина проспекта: ларьки 3×2 и клумбы 2×2 через every тайлов — не у устья переулка или площади
 * (clear), не ближе endClear к концам проспекта (from/to — где кончается сам проспект, без КПП);
 * вокруг — кольцо асфальта. Ларёк и клумба чередуются. Тайлы — укрытие (BARRIER): не пройти, видно поверх.
 */
export function placeAvenueDecor(g: GenGrid, rng: Rng, av: Avenue, pois: Poi[], kioskStart = 0, from = av.segs[0].from, to = av.segs[av.segs.length - 1].to): number {
  const D = GENERATOR.facades.decor;
  const at = (u: number, v: number) => (av.horizontal ? { x: u, y: v } : { x: v, y: u });
  const u0 = from + D.endClear;
  const u1 = to - D.endClear;
  let kiosk = kioskStart;
  let placed = 0;
  let face = rng.chance(0.5);
  let isKiosk = rng.chance(D.kioskShare);
  const edgeClosed = (u: number) => {
    const s = avenueSegAt(av, u);
    for (const v of [s.offset - 1, s.offset + s.width]) {
      const p = at(u, v);
      const t = g.get(p.x, p.y);
      if (SOLID[t] === 0 && t !== T.DOOR) return false;
    }
    return true;
  };
  for (let u = u0; u <= u1; ) {
    const len = isKiosk ? 3 : 2;
    const s = avenueSegAt(av, u);
    const v = s.offset + (s.width >> 1) - 1;
    let ok = u + len - 1 <= u1 && s.to >= u + len - 1 && s.width >= 8;
    for (let du = -D.clear; ok && du < len + D.clear; du++) if (!edgeClosed(u + du)) ok = false;
    // Сам ларёк и кольцо вокруг — свободный асфальт.
    for (let du = -1; ok && du <= len; du++) {
      for (let dv = -1; dv <= 2; dv++) {
        const p = at(u + du, v + dv);
        if (g.get(p.x, p.y) !== T.STREET || g.isLocked(p.x, p.y)) ok = false;
      }
    }
    if (!ok) {
      u += 2;
      continue;
    }
    for (let du = 0; du < len; du++) {
      for (const dv of [0, 1]) {
        const p = at(u + du, v + dv);
        g.set(p.x, p.y, T.BARRIER);
        g.locked[p.y * g.w + p.x] = 1;
      }
    }
    const p = at(u, v);
    const q = at(u + len - 1, v + 1);
    const rect = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x) + 1, h: Math.abs(q.y - p.y) + 1 };
    if (isKiosk) {
      const k = ARBAT.kiosks[kiosk++ % ARBAT.kiosks.length];
      face = !face;
      const f: Face = av.horizontal ? (face ? 'N' : 'S') : face ? 'W' : 'E';
      pois.push({ type: 'kiosk', ...rect, sub: k.id, face: f });
    } else {
      pois.push({ type: 'planter', ...rect });
    }
    placed++;
    isKiosk = !isKiosk;
    u += len + rng.int(D.every[0], D.every[1]);
  }
  return placed;
}

/**
 * Площадка перед зданием у проспекта (Управа): застройка между его краем и асфальтом (проспект
 * изгибается, край неровный) — асфальт, чтобы фасад Управы выходил прямо на улицу.
 */
export function fillForecourt(g: GenGrid, av: Avenue, r: Rect, zone: number): void {
  const along0 = av.horizontal ? r.x : r.y;
  const along1 = along0 + (av.horizontal ? r.w : r.h) - 1;
  const lo = av.horizontal ? r.y : r.x;
  const hi = lo + (av.horizontal ? r.h : r.w);
  for (let u = along0; u <= along1; u++) {
    const s = avenueSegAt(av, u);
    const [a, b] = hi <= s.offset ? [hi, s.offset - 1] : lo >= s.offset + s.width ? [s.offset + s.width, lo - 1] : [1, 0];
    for (let v = a; v <= b; v++) {
      const x = av.horizontal ? u : v;
      const y = av.horizontal ? v : u;
      if (g.get(x, y) !== T.WALL || g.isLocked(x, y)) continue;
      g.set(x, y, T.STREET);
      g.zones[y * g.w + x] = zone;
    }
  }
}
