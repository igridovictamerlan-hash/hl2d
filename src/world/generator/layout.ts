import type { Rng } from '../../core/rng';
import { clamp, rectsOverlap, type Rect, type Vec2 } from '../../core/math';
import { GENERATOR, type CheckpointType } from '../../config/generator';
import { NEXUS_TEMPLATE, CWU_HQ_TEMPLATE } from './templates';
import { CHECKPOINTS } from './checkpoints';

/**
 * Макро-план города: магистрали, линии решётки, прямоугольники районов и штампов.
 * Сама карта здесь не рисуется — только геометрия, которую потом «вырезают» другие шаги.
 */

export type Side = 'N' | 'S' | 'E' | 'W';

export interface AvenueSeg {
  /** Диапазон вдоль магистрали (включительно). */
  from: number;
  to: number;
  /** Поперечная координата первого ряда асфальта и ширина асфальта на этом участке. */
  offset: number;
  width: number;
}

export interface Avenue {
  horizontal: boolean;
  /** Номинальная ширина (участки — width ± edgeJitter). */
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
  /** Главный горизонтальный проспект (с площадью и Управой). */
  hAvenue: Avenue;
  /** Второй горизонтальный проспект (от другого западного КПП) и его линия решётки. */
  hAvenue2: Avenue;
  hLine2: number;
  vAvenue: Avenue | null;
  restricted: Rect;
  restrictedGates: GateSpec[];
  industrial: Rect;
  plaza: Rect;
  plazaSide: 'N' | 'S';
  nexus: Rect;
  nexusRot: 0 | 180;
  /** Штаб ТС: фасадом (face — куда вход) на главный проспект, вдали от Управы, площади и КПП. */
  cwuHq: { rect: Rect; face: 'N' | 'S' } | null;
  /**
   * Пограничные КПП у западной стены: [0] — «Север» на оси северного проспекта, [1] — «Юг» на оси южного;
   * mirror — город с запада (сейчас не бывает, задел); type — вид КПП.
   */
  checkpoints: { rect: Rect; mirror: boolean; type: CheckpointType }[];
  quarterSeeds: Vec2[];
}

/** Участок магистрали, на который приходится координата pos вдоль неё (за концами — крайний). */
export function avenueSegAt(av: Avenue, pos: number): AvenueSeg {
  for (const s of av.segs) if (pos >= s.from && pos <= s.to) return s;
  return pos < av.segs[0].from ? av.segs[0] : av.segs[av.segs.length - 1];
}

export function avenueOffsetAt(av: Avenue, pos: number): number {
  return avenueSegAt(av, pos).offset;
}

/** Прямоугольники асфальта магистрали. */
export function avenueRects(av: Avenue): Rect[] {
  return av.segs.map((s) =>
    av.horizontal
      ? { x: s.from, y: s.offset, w: s.to - s.from + 1, h: s.width }
      : { x: s.offset, y: s.from, w: s.width, h: s.to - s.from + 1 },
  );
}

/**
 * Линии решётки с шагом [smin, smax]; fixed — обязательные линии магистралей (по возрастанию) с отступами до
 * соседей; fixedIndex — индексы этих линий в результате (в том же порядке).
 */
export function genLines(
  rng: Rng,
  lo: number,
  hi: number,
  smin: number,
  smax: number,
  fixed: readonly { pos: number; before: number; after: number }[] = [],
): { lines: number[]; fixedIndex: number[] } {
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
  const fixedIndex: number[] = [];
  let from = lo;
  for (const f of fixed) {
    fill(from, f.pos - f.before);
    fixedIndex.push(lines.length);
    lines.push(f.pos);
    from = f.pos + f.after;
    if (from > hi) return { lines, fixedIndex };
    lines.push(from);
  }
  fill(from, hi);
  return { lines, fixedIndex };
}

/**
 * Участки проспекта старого города: ось center плавно изгибается (bends полуволн синусоиды с
 * амплитудой amp, от концов — с разгоном на ease тайлов), участок длиной segmentLength ≈ фасад дома;
 * ось на стыке сдвигается не больше maxStep, края — каждый на ±edgeJitter. long — прямой участок
 * без сдвигов под площадь.
 */
function planAvenueSegs(
  rng: Rng,
  from: number,
  to: number,
  center: number,
  width: number,
  long?: { center: number; length: number },
): AvenueSeg[] {
  const cfg = GENERATOR.avenue;
  const segs: AvenueSeg[] = [];
  const amp = rng.int(cfg.amp[0], cfg.amp[1]);
  const bends = rng.int(cfg.bends[0], cfg.bends[1]);
  const phase = rng.chance(0.5) ? 0 : Math.PI;
  const len = Math.max(1, to - from);
  const half = Math.floor(width / 2);
  // Ось: синусоида с плавным выходом от концов (у КПП ось совпадает с center).
  const target = (pos: number) => {
    const t = (pos - from) / len;
    const ease = Math.min(1, (pos - from) / cfg.ease, (to - pos) / cfg.ease);
    return center + amp * Math.max(0, ease) * Math.sin(phase + Math.PI * bends * t);
  };
  let c = center;
  const push = (a: number, b: number, straight: boolean) => {
    c = clamp(Math.round(target((a + b) / 2)), c - cfg.maxStep, c + cfg.maxStep);
    const jn = straight ? 0 : rng.int(-cfg.edgeJitter, cfg.edgeJitter);
    const js = straight ? 0 : rng.int(-cfg.edgeJitter, cfg.edgeJitter);
    segs.push({ from: a, to: b, offset: c - half + jn, width: width - jn + js });
  };
  const fill = (a: number, b: number) => {
    let pos = a;
    while (pos <= b) {
      let n = rng.int(cfg.segmentLength[0], cfg.segmentLength[1]);
      if (b - (pos + n) + 1 < cfg.segmentLength[0]) n = b - pos + 1;
      push(pos, Math.min(b, pos + n - 1), false);
      pos += n;
    }
  };
  if (long) {
    const ls = long.center - Math.floor(long.length / 2);
    const le = ls + long.length - 1;
    if (ls - 1 >= from) fill(from, ls - 1);
    push(ls, le, true);
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
    maxO = Math.max(maxO, s.offset + s.width);
  }
  const from = segs[0].from;
  const to = segs[segs.length - 1].to;
  const band = horizontal
    ? { x: from, y: minO, w: to - from + 1, h: maxO - minO }
    : { x: minO, y: from, w: maxO - minO, h: to - from + 1 };
  return { horizontal, width, center, segs, band };
}

/** Насколько проспект отходит от оси (изгиб + неровность краёв). */
export function avenueReach(): number {
  return GENERATOR.avenue.amp[1] + GENERATOR.avenue.edgeJitter;
}

/** Полоса домов вдоль проспекта (фасад + глухая застройка за ним) — там не прокладываются переулки. */
export function facadeReach(): number {
  const F = GENERATOR.facades;
  return Math.max(F.depth[1], F.canteen.depth[1]) + F.backGap;
}

/**
 * Отступы соседних линий решётки от линии магистрали: между асфальтом и переулком — ряд домов
 * (facadeReach), переулки к проспекту пересекают его прямо (изломы — дальше, см. finalizeEdges).
 */
function avenueSpacing(width: number): { before: number; after: number } {
  const L = GENERATOR.lattice;
  const gap = 1;
  const half = Math.floor(width / 2);
  const side = avenueReach() + facadeReach() + L.jitter + gap;
  return {
    before: half + side + GENERATOR.alley.mainWidth,
    after: width - half + side,
  };
}

const CORNERS = ['NW', 'NE', 'SW', 'SE'] as const;
/** Запретная зона и промзона — в восточных углах: запад занят пограничными КПП. */
const EAST_CORNERS = ['NE', 'SE'] as const;
type Corner = (typeof CORNERS)[number];


export function planLayout(rng: Rng, W: number, H: number, cpTypes: readonly [CheckpointType, CheckpointType]): CityLayout {
  const G = GENERATOR;
  const border = G.border;
  const L = G.lattice;

  // Магистрали: северный и южный проспекты от западных КПП до восточной стены, вертикальная — через оба у площади.
  const A = G.avenue;
  const nWidth = rng.int(A.width[0], A.width[1]);
  const sWidth = rng.int(A.width[0], A.width[1]);
  const nCenter = rng.int(Math.round(H * A.north[0]), Math.round(H * A.north[1]));
  const sCenter = rng.int(Math.round(H * A.south[0]), Math.round(H * A.south[1]));
  const vWidth = rng.int(A.width[0], A.width[1]);
  const vCenter = rng.int(Math.round(W * A.vertical[0]), Math.round(W * A.vertical[1]));
  const mainNorth = rng.chance(0.5);

  // Углы: запретная зона и промзона — в восточных углах (запад — фронт, там оба КПП). Угол не залезает на
  // ряд домов вдоль проспекта: высота — сколько остаётся до полосы проспекта, ширина — чтобы площадь была как
  // у квадрата size × size (но не шире maxStretch × size).
  const corners = rng.shuffle([...EAST_CORNERS]);
  const restrictedCorner = corners[0];
  const industrialCorner = corners[1];
  const band = (center: number, width: number) => ({
    top: center - Math.floor(width / 2) - avenueReach() - facadeReach() - A.eastClear,
    bottom: center + width - Math.floor(width / 2) + avenueReach() + facadeReach() + A.eastClear,
  });
  const cornerFit = (c: Corner, size: number): Rect => {
    const room = c.startsWith('N') ? band(nCenter, nWidth).top - border : H - border - band(sCenter, sWidth).bottom;
    const h = Math.max(1, Math.min(size, room));
    const w = Math.min(Math.round((size * size) / h), Math.round(size * G.cornerStretch));
    return { x: W - border - w, y: c.startsWith('N') ? border : H - border - h, w, h };
  };
  const rSize = rng.int(G.restricted.size[0], G.restricted.size[1]);
  const restricted = cornerFit(restrictedCorner, rSize);
  const iSize = rng.int(G.industrial.size[0], G.industrial.size[1]);
  const industrial = cornerFit(industrialCorner, iSize);
  const nEnd = W - border - 1;
  const sEnd = W - border - 1;

  const lo = border + L.margin;
  const hiX = W - border - L.margin - G.alley.mainWidth - L.jitter;
  const hiY = H - border - L.margin - G.alley.mainWidth - L.jitter;
  const ys = genLines(rng, lo, hiY, L.spacingMin, L.spacingMax, [
    { pos: nCenter, ...avenueSpacing(nWidth) },
    { pos: sCenter, ...avenueSpacing(sWidth) },
  ]);
  const xs = genLines(rng, lo, hiX, L.spacingMin, L.spacingMax, [{ pos: vCenter, ...avenueSpacing(vWidth) }]);

  // Площадь примыкает к главному проспекту на длинном прямом участке у вертикальной магистрали.
  const plazaSize = rng.int(G.plaza.size[0], G.plaza.size[1]);
  const vHalf = Math.floor(vWidth / 2) + avenueReach() + facadeReach();
  const off = vHalf + Math.ceil(plazaSize / 2) + 5;
  const longCenter = vCenter + (rng.chance(0.5) ? off : -off);
  const [mCenter, mWidth, mEnd, oCenter, oWidth, oEnd] = mainNorth
    ? [nCenter, nWidth, nEnd, sCenter, sWidth, sEnd]
    : [sCenter, sWidth, sEnd, nCenter, nWidth, nEnd];
  const hSegs = planAvenueSegs(rng, border, mEnd, mCenter, mWidth, { center: longCenter, length: A.plazaSegment });
  const hAvenue = makeAvenue(true, mWidth, mCenter, hSegs);
  const hAvenue2 = makeAvenue(true, oWidth, oCenter, planAvenueSegs(rng, border, oEnd, oCenter, oWidth));
  const vAvenue = makeAvenue(false, vWidth, vCenter, planAvenueSegs(rng, border, H - border - 1, vCenter, vWidth));

  // Ворота запретной зоны — на западной стороне (к кварталам): северная или южная смотрит в тыл ряда домов
  // вдоль проспекта. Две — в разных половинах стороны.
  const gateCount = rng.int(G.restricted.gates[0], G.restricted.gates[1]);
  const gw = G.restricted.gateWidth;
  const restrictedGates: GateSpec[] = [];
  for (let k = 0; k < gateCount; k++) {
    const half = Math.floor(restricted.h / gateCount);
    const lo = restricted.y + k * half + 6;
    const hi = restricted.y + (k + 1) * half - 6 - gw;
    if (hi < lo) continue;
    restrictedGates.push({ side: 'W', pos: rng.int(lo, hi), width: gw });
  }
  if (!restrictedGates.length) restrictedGates.push({ side: 'W', pos: restricted.y + ((restricted.h - gw) >> 1), width: gw });

  // Площадь.
  const longSeg = hSegs.find((s) => s.from <= longCenter && s.to >= longCenter)!;
  const plazaSide: 'N' | 'S' = rng.chance(0.5) ? 'N' : 'S';
  const px = clamp(longCenter - Math.floor(plazaSize / 2) + rng.int(-2, 2), longSeg.from, longSeg.to - plazaSize + 1);
  const py = plazaSide === 'N' ? longSeg.offset - plazaSize : longSeg.offset + longSeg.width;
  const plaza: Rect = { x: px, y: py, w: plazaSize, h: plazaSize };

  // Пограничные КПП у западной стены: [0] «Север» — на оси северного проспекта, [1] «Юг» — южного.
  // Коридор КПП продолжает свой проспект.
  const checkpoints = [true, false].map((north, k) => {
    const type = cpTypes[k];
    const def = CHECKPOINTS[type];
    const av = north === mainNorth ? hAvenue : hAvenue2;
    const x = border;
    const seg = avenueSegAt(av, x + def.w - 1);
    const mid = seg.offset + Math.floor(seg.width / 2);
    // Ось КПП (ворота, шорт) совпадает с серединой проспекта.
    return { rect: { x, y: mid - def.axisRow, w: def.w, h: def.h }, mirror: false, type };
  });
  for (const c of checkpoints) {
    if (rectsOverlap(c.rect, restricted, 3) || rectsOverlap(c.rect, industrial, 3) || rectsOverlap(c.rect, plaza, 3)) {
      throw new Error('layout: КПП пересекается с районом');
    }
  }
  if (rectsOverlap(checkpoints[0].rect, checkpoints[1].rect, 6)) throw new Error('layout: КПП пересекаются');

  // Управа: рядом с площадью или напротив неё, воротами к магистрали.
  const nw = NEXUS_TEMPLATE[0].length;
  const nh = NEXUS_TEMPLATE.length;
  const R2 = avenueReach() + facadeReach();
  const h2 = hAvenue2.band;
  const blocked: Rect[] = [restricted, industrial, plaza, ...checkpoints.map((c) => c.rect), vAvenue.band, { x: h2.x, y: h2.y - R2, w: h2.w, h: h2.h + 2 * R2 }];
  const candidates: { rect: Rect; rot: 0 | 180 }[] = [];
  const nexusOnSide = (side: 'N' | 'S', x: number) => {
    let top = Infinity;
    let bottom = -Infinity;
    for (let cx = x; cx < x + nw; cx++) {
      const sg = avenueSegAt(hAvenue, cx);
      top = Math.min(top, sg.offset);
      bottom = Math.max(bottom, sg.offset + sg.width);
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
  if (!pick) throw new Error('layout: нет места для Управы');
  if (!inMap(plaza) || rectsOverlap(plaza, restricted, 4) || rectsOverlap(plaza, industrial, 4) || rectsOverlap(plaza, vAvenue.band, 1)) {
    throw new Error('layout: площадь не помещается');
  }

  // Штаб ТС — фасадом на главный проспект, вдали от Управы, площади и КПП (там бой).
  const H_ = GENERATOR.cwuHq;
  const hw = CWU_HQ_TEMPLATE[0].length;
  const hh = CWU_HQ_TEMPLATE.length;
  const hqBlocked: Rect[] = [...blocked, pick.rect];
  {
    const R = avenueReach() + facadeReach();
    hqBlocked.push({ x: vAvenue.band.x - R, y: vAvenue.band.y, w: vAvenue.band.w + 2 * R, h: vAvenue.band.h });
  }
  // От западных КПП (там бой) — на восток до конца главного проспекта.
  const cpEdge = Math.max(...checkpoints.map((c) => c.rect.x + c.rect.w));
  const gap = (a: Rect, b: Rect) => Math.hypot(Math.max(b.x - a.x - a.w, a.x - b.x - b.w, 0), Math.max(b.y - a.y - a.h, a.y - b.y - b.h, 0));
  let cwuHq: { rect: Rect; face: 'N' | 'S' } | null = null;
  let hqScore = -Infinity;
  const hEnd = hAvenue.band.x + hAvenue.band.w - 1;
  for (let x = cpEdge + H_.cpClear; x + hw <= hEnd; x += 2) {
    for (const side of ['N', 'S'] as const) {
      let top = Infinity;
      let bottom = -Infinity;
      for (let cx = x; cx < x + hw; cx++) {
        const sg = avenueSegAt(hAvenue, cx);
        top = Math.min(top, sg.offset);
        bottom = Math.max(bottom, sg.offset + sg.width);
      }
      const rect = { x, y: side === 'N' ? top - hh : bottom, w: hw, h: hh };
      if (!inMap(rect) || hqBlocked.some((b) => rectsOverlap(rect, b, 3))) continue;
      // Расстояния — между краями (Управа велик: по центрам штаб вставал бы вплотную к нему).
      const dCp = Math.max(rect.x - cpEdge, 0);
      const score = Math.min(gap(rect, pick.rect), gap(rect, plaza), dCp * H_.cpWeight) + rng.next();
      if (score > hqScore) {
        hqScore = score;
        cwuHq = { rect, face: side === 'N' ? 'S' : 'N' };
      }
    }
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
    hLine: ys.fixedIndex[mainNorth ? 0 : 1],
    vLine: xs.fixedIndex[0],
    hAvenue,
    hAvenue2,
    hLine2: ys.fixedIndex[mainNorth ? 1 : 0],
    vAvenue,
    restricted,
    restrictedGates,
    industrial,
    plaza,
    plazaSide,
    nexus: pick.rect,
    nexusRot: pick.rot,
    cwuHq,
    checkpoints,
    quarterSeeds,
  };
}
