import type { Rng } from '../../core/rng';
import { clamp, rectsOverlap, type Rect, type Vec2 } from '../../core/math';
import { GENERATOR } from '../../config/generator';
import { NEXUS_TEMPLATE, CHECKPOINT_TEMPLATE } from './templates';

/**
 * Макро-план города: магистрали, линии решётки, прямоугольники районов и штампов.
 * Сама карта здесь не рисуется — только геометрия, которую потом «вырезают» другие шаги.
 */

export type Side = 'N' | 'S' | 'E' | 'W';

export interface AvenueSeg {
  /** Диапазон вдоль магистрали (включительно). */
  from: number;
  to: number;
  /** Поперечная координата первого ряда асфальта. */
  offset: number;
}

export interface Avenue {
  horizontal: boolean;
  width: number;
  center: number;
  segs: AvenueSeg[];
  /** Ограничивающий прямоугольник всех сегментов. */
  band: Rect;
}

export interface GateSpec {
  side: Side;
  /** Начало ворот вдоль стороны. */
  pos: number;
  width: number;
}

export interface CityLayout {
  xs: number[];
  ys: number[];
  /** Индексы линий решётки, по которым идут магистрали (-1 — нет). */
  hLine: number;
  vLine: number;
  hAvenue: Avenue;
  vAvenue: Avenue | null;
  restricted: Rect;
  restrictedGates: GateSpec[];
  industrial: Rect;
  plaza: Rect;
  plazaSide: 'N' | 'S';
  nexus: Rect;
  nexusRot: 0 | 180;
  /** Пограничные КПП на концах главного проспекта; mirror — город с запада (восточный конец). */
  checkpoints: { rect: Rect; mirror: boolean }[];
  quarterSeeds: Vec2[];
}

export function avenueOffsetAt(av: Avenue, pos: number): number {
  for (const s of av.segs) if (pos >= s.from && pos <= s.to) return s.offset;
  return pos < av.segs[0].from ? av.segs[0].offset : av.segs[av.segs.length - 1].offset;
}

/** Прямоугольники асфальта магистрали. */
export function avenueRects(av: Avenue): Rect[] {
  return av.segs.map((s) =>
    av.horizontal
      ? { x: s.from, y: s.offset, w: s.to - s.from + 1, h: av.width }
      : { x: s.offset, y: s.from, w: av.width, h: s.to - s.from + 1 },
  );
}

/** Линии решётки с шагом [smin, smax]; fixed — обязательная линия магистрали с отступами до соседей. */
export function genLines(
  rng: Rng,
  lo: number,
  hi: number,
  smin: number,
  smax: number,
  fixed?: { pos: number; before: number; after: number },
): { lines: number[]; fixedIndex: number } {
  const lines = [lo];
  const fill = (start: number, end: number) => {
    let y = start;
    while (end - y >= smin) {
      const rem = end - y;
      let s: number;
      if (rem <= smax) s = rem;
      else {
        s = rng.int(smin, smax);
        if (rem - s < smin) s = rem - smin;
        if (s < smin) s = Math.floor(rem / 2);
      }
      y += s;
      lines.push(y);
    }
  };
  let fixedIndex = -1;
  if (fixed) {
    fill(lo, fixed.pos - fixed.before);
    fixedIndex = lines.length;
    lines.push(fixed.pos);
    const next = fixed.pos + fixed.after;
    if (next <= hi) {
      lines.push(next);
      fill(next, hi);
    }
  } else {
    fill(lo, hi);
  }
  return { lines, fixedIndex };
}

function planAvenueSegs(
  rng: Rng,
  from: number,
  to: number,
  base: number,
  long?: { center: number; length: number },
): AvenueSeg[] {
  const cfg = GENERATOR.avenue;
  const segs: AvenueSeg[] = [];
  let offset = base;
  let sign = rng.chance(0.5) ? 1 : -1;
  const nextOffset = () => {
    const j = rng.int(cfg.jog[0], cfg.jog[1]);
    let o = offset + sign * j;
    if (Math.abs(o - base) > cfg.maxDrift) {
      sign = -sign;
      o = offset + sign * j;
    }
    if (rng.chance(0.6)) sign = -sign;
    return clamp(o, base - cfg.maxDrift, base + cfg.maxDrift);
  };
  const fill = (a: number, b: number) => {
    let pos = a;
    while (pos <= b) {
      let len = rng.int(cfg.segmentLength[0], cfg.segmentLength[1]);
      if (b - (pos + len) + 1 < cfg.segmentLength[0] / 2) len = b - pos + 1;
      const end = Math.min(b, pos + len - 1);
      segs.push({ from: pos, to: end, offset });
      offset = nextOffset();
      pos = end + 1;
    }
  };
  if (long) {
    const ls = long.center - Math.floor(long.length / 2);
    const le = ls + long.length - 1;
    if (ls - 1 >= from) fill(from, ls - 1);
    segs.push({ from: ls, to: le, offset });
    offset = nextOffset();
    if (le + 1 <= to) fill(le + 1, to);
  } else {
    fill(from, to);
  }
  return segs;
}

function makeAvenue(horizontal: boolean, width: number, center: number, segs: AvenueSeg[]): Avenue {
  let minO = Infinity;
  let maxO = -Infinity;
  for (const s of segs) {
    minO = Math.min(minO, s.offset);
    maxO = Math.max(maxO, s.offset);
  }
  const from = segs[0].from;
  const to = segs[segs.length - 1].to;
  const band = horizontal
    ? { x: from, y: minO, w: to - from + 1, h: maxO - minO + width }
    : { x: minO, y: from, w: maxO - minO + width, h: to - from + 1 };
  return { horizontal, width, center, segs, band };
}

/** Отступы соседних линий решётки от линии магистрали (чтобы переулки не липли к асфальту). */
function avenueSpacing(width: number): { before: number; after: number } {
  const L = GENERATOR.lattice;
  const drift = GENERATOR.avenue.maxDrift;
  const gap = 3;
  const half = Math.floor(width / 2);
  return {
    before: half + drift + L.jitter + GENERATOR.alley.mainWidth + gap,
    after: width - half + drift + gap + L.jitter,
  };
}

const CORNERS = ['NW', 'NE', 'SW', 'SE'] as const;
type Corner = (typeof CORNERS)[number];

function cornerRect(c: Corner, size: number, W: number, H: number, border: number): Rect {
  const x = c.endsWith('W') ? border : W - border - size;
  const y = c.startsWith('N') ? border : H - border - size;
  return { x, y, w: size, h: size };
}

export function planLayout(rng: Rng, W: number, H: number): CityLayout {
  const G = GENERATOR;
  const border = G.border;
  const L = G.lattice;

  // Углы: запретная зона и промзона — в разных углах.
  const corners = rng.shuffle([...CORNERS]);
  const restrictedCorner = corners[0];
  const industrialCorner = corners[1];

  // Магистрали.
  const hWidth = rng.int(G.avenue.width[0], G.avenue.width[1]);
  const hCenter = rng.int(Math.round(H * 0.42), Math.round(H * 0.58));
  const hasV = rng.chance(G.avenue.secondChance);
  const vWidth = rng.int(G.avenue.width[0], G.avenue.width[1]);
  const vCenter = rng.int(Math.round(W * 0.38), Math.round(W * 0.62));

  const lo = border + L.margin;
  const hiX = W - border - L.margin - G.alley.mainWidth - L.jitter;
  const hiY = H - border - L.margin - G.alley.mainWidth - L.jitter;
  const ySp = avenueSpacing(hWidth);
  const ys = genLines(rng, lo, hiY, L.spacingMin, L.spacingMax, { pos: hCenter, ...ySp });
  const vSp = avenueSpacing(vWidth);
  const xs = hasV
    ? genLines(rng, lo, hiX, L.spacingMin, L.spacingMax, { pos: vCenter, ...vSp })
    : genLines(rng, lo, hiX, L.spacingMin, L.spacingMax);

  // Площадь примыкает к горизонтальной магистрали на длинном прямом участке.
  const plazaSize = rng.int(G.plaza.size[0], G.plaza.size[1]);
  const vHalf = Math.floor(vWidth / 2) + G.avenue.maxDrift;
  let longCenter: number;
  if (hasV) {
    const off = vHalf + Math.ceil(plazaSize / 2) + 5;
    longCenter = vCenter + (rng.chance(0.5) ? off : -off);
  } else {
    longCenter = Math.round(W / 2) + rng.int(-10, 10);
  }
  const hSegs = planAvenueSegs(rng, border, W - border - 1, hCenter - Math.floor(hWidth / 2), {
    center: longCenter,
    length: G.avenue.plazaSegment,
  });
  const hAvenue = makeAvenue(true, hWidth, hCenter, hSegs);
  const vAvenue = hasV
    ? makeAvenue(false, vWidth, vCenter, planAvenueSegs(rng, border, H - border - 1, vCenter - Math.floor(vWidth / 2)))
    : null;

  // Запретная зона и промзона.
  const rSize = rng.int(G.restricted.size[0], G.restricted.size[1]);
  const restricted = cornerRect(restrictedCorner, rSize, W, H, border);
  const iSize = rng.int(G.industrial.size[0], G.industrial.size[1]);
  const industrial = cornerRect(industrialCorner, iSize, W, H, border);

  // Ворота запретной зоны — на сторонах, обращённых к городу.
  const facing: Side[] = [
    restrictedCorner.startsWith('N') ? 'S' : 'N',
    restrictedCorner.endsWith('W') ? 'E' : 'W',
  ];
  const gateCount = rng.int(G.restricted.gates[0], G.restricted.gates[1]);
  const restrictedGates: GateSpec[] = rng
    .shuffle([...facing])
    .slice(0, gateCount)
    .map((side) => ({
      side,
      pos: rng.int(8, rSize - 8 - G.restricted.gateWidth) + (side === 'N' || side === 'S' ? restricted.x : restricted.y),
      width: G.restricted.gateWidth,
    }));

  // Площадь.
  const longSeg = hSegs.find((s) => s.from <= longCenter && s.to >= longCenter)!;
  const plazaSide: 'N' | 'S' = rng.chance(0.5) ? 'N' : 'S';
  const px = clamp(longCenter - Math.floor(plazaSize / 2) + rng.int(-2, 2), longSeg.from, longSeg.to - plazaSize + 1);
  const py = plazaSide === 'N' ? longSeg.offset - plazaSize : longSeg.offset + hWidth;
  const plaza: Rect = { x: px, y: py, w: plazaSize, h: plazaSize };

  // Пограничные КПП: коридор КПП продолжает главный проспект у западной и восточной стены.
  const cw = CHECKPOINT_TEMPLATE[0].length;
  const ch = CHECKPOINT_TEMPLATE.length;
  const checkpoints = [false, true].map((mirror) => {
    const x = mirror ? W - border - cw : border;
    const apronX = mirror ? x : x + cw - 1;
    const mid = avenueOffsetAt(hAvenue, apronX) + Math.floor(hWidth / 2);
    // Ряды коридора в шаблоне — 8..11: центр коридора совпадает с серединой проспекта.
    return { rect: { x, y: mid - 10, w: cw, h: ch }, mirror };
  });
  for (const c of checkpoints) {
    if (rectsOverlap(c.rect, restricted, 3) || rectsOverlap(c.rect, plaza, 3)) {
      throw new Error('layout: КПП пересекается с районом');
    }
  }

  // Нексус: рядом с площадью или напротив неё, воротами к магистрали.
  const nw = NEXUS_TEMPLATE[0].length;
  const nh = NEXUS_TEMPLATE.length;
  const blocked: Rect[] = [restricted, plaza, ...checkpoints.map((c) => c.rect)];
  if (vAvenue) blocked.push(vAvenue.band);
  const candidates: { rect: Rect; rot: 0 | 180 }[] = [];
  const nexusOnSide = (side: 'N' | 'S', x: number) => {
    let top = Infinity;
    let bottom = -Infinity;
    for (let cx = x; cx < x + nw; cx++) {
      const o = avenueOffsetAt(hAvenue, cx);
      top = Math.min(top, o);
      bottom = Math.max(bottom, o + hWidth);
    }
    const y = side === 'N' ? top - nh : bottom;
    candidates.push({ rect: { x, y, w: nw, h: nh }, rot: side === 'N' ? 0 : 180 });
  };
  const gapToPlaza = 3;
  const sideOrder = rng.chance(0.5) ? [-1, 1] : [1, -1];
  for (const dir of sideOrder) {
    nexusOnSide(plazaSide, dir < 0 ? plaza.x - gapToPlaza - nw : plaza.x + plaza.w + gapToPlaza);
  }
  const opposite = plazaSide === 'N' ? 'S' : 'N';
  nexusOnSide(opposite, plaza.x + Math.floor(plaza.w / 2) - Math.floor(nw / 2));
  for (const dir of sideOrder) {
    nexusOnSide(opposite, dir < 0 ? plaza.x - gapToPlaza - nw : plaza.x + plaza.w + gapToPlaza);
  }
  const inMap = (r: Rect) => r.x >= border + 2 && r.y >= border + 2 && r.x + r.w <= W - border - 2 && r.y + r.h <= H - border - 2;
  const pick = candidates.find((c) => inMap(c.rect) && !blocked.some((b) => rectsOverlap(c.rect, b, 3)));
  if (!pick) throw new Error('layout: нет места для Нексуса');
  if (!inMap(plaza) || rectsOverlap(plaza, restricted, 4) || (vAvenue && rectsOverlap(plaza, vAvenue.band, 1))) {
    throw new Error('layout: площадь не помещается');
  }

  // Семена жилых кварталов (для названий районов).
  const quarterSeeds: Vec2[] = [];
  for (let tries = 0; quarterSeeds.length < G.residential.quarters && tries < 500; tries++) {
    const p = { x: rng.int(border + 10, W - border - 10), y: rng.int(border + 10, H - border - 10) };
    const r = { x: p.x, y: p.y, w: 1, h: 1 };
    if (rectsOverlap(r, restricted, 4) || rectsOverlap(r, industrial, 4)) continue;
    if (quarterSeeds.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 45)) continue;
    quarterSeeds.push(p);
  }
  if (quarterSeeds.length === 0) quarterSeeds.push({ x: W / 2, y: H / 2 });

  return {
    xs: xs.lines,
    ys: ys.lines,
    hLine: ys.fixedIndex,
    vLine: hasV ? xs.fixedIndex : -1,
    hAvenue,
    vAvenue,
    restricted,
    restrictedGates,
    industrial,
    plaza,
    plazaSide,
    nexus: pick.rect,
    nexusRot: pick.rot,
    checkpoints,
    quarterSeeds,
  };
}
