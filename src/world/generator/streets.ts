import type { Rng } from '../../core/rng';
import { rectsOverlap, type Rect } from '../../core/math';
import { GENERATOR } from '../../config/generator';
import { T } from '../tiles';
import type { GenGrid } from './GenGrid';
import type { Lattice, LEdge } from './lattice';
import { ARSENAL_TEMPLATE, CWU_HQ_TEMPLATE, DORM_TEMPLATE, VILLA_TEMPLATE } from './templates';

/** Улица-артерия: рёбра и узлы решётки, по которым она идёт. */
export interface Artery {
  edges: number[];
  nodes: number[];
  /** Ширина: артерия — streets.width, улочка от неё — streets.lanes.width. */
  width: number;
  /** Идёт от проспекта (или от площади у него) — по ней до проспекта можно дойти улицей, без переулков. */
  rooted: boolean;
}

/** Здание вдоль улицы: прямоугольник и куда смотрит вход (на улицу). */
export interface Placement {
  rect: Rect;
  face: 'N' | 'S' | 'E' | 'W';
}

export interface StreetPlan {
  arteries: Artery[];
  dorms: Placement[];
  villas: Placement[];
  /** Штаб ГСР (у главного проспекта) или null, если места не нашлось. */
  hq: Placement | null;
  /** Склад Альянса (на окраине, у улицы от проспекта) или null. */
  arsenal: Placement | null;
}

/**
 * Улицы-артерии от проспекта и места под общежития и особняки. Работает по решётке после
 * разметки регионов, до лабиринта: рёбра артерий сразу вырезаются (carved), места зданий
 * становятся пустотами — лабиринт их обходит, а переулки подходят к ним снаружи.
 */
export function planStreets(lat: Lattice, rng: Rng, hLine: number, plaza: { rect: Rect; side: 'N' | 'S' }, blocked: readonly Rect[], mapW: number, mapH: number): StreetPlan {
  const S = GENERATOR.streets;
  const arteries: Artery[] = [];
  const inArtery = new Uint8Array(lat.edges.length);
  const usable = (e: LEdge | undefined): e is LEdge => {
    if (!e || !e.valid || e.virtual) return false;
    const A = lat.nodes[e.a];
    const B = lat.nodes[e.b];
    return A.region === 'city' && B.region === 'city' && e.district === 'residential';
  };
  const idOf = (e: LEdge) => lat.edges.indexOf(e);

  // Корни стволов: узлы проспекта (в обе стороны) и узлы у площади (вглубь от проспекта).
  interface Cand { i: number; dir: -1 | 1; spine: LEdge[]; rooted: boolean; }
  const cands: Cand[] = [];
  const walk = (i: number, j0: number, dir: -1 | 1, steps: number): LEdge[] => {
    const out: LEdge[] = [];
    let j = j0;
    for (let k = 0; k < steps; k++) {
      const e = dir < 0 ? lat.vEdge(i, j - 1) : lat.vEdge(i, j);
      if (!usable(e) || inArtery[idOf(e)]) break;
      out.push(e);
      j += dir;
    }
    return out;
  };
  const w3 = GENERATOR.alley.mainWidth;
  for (let i = 0; i < lat.cols; i++) {
    for (const dir of [-1, 1] as const) {
      const spine = walk(i, hLine, dir, rng.int(S.branchRow[0], S.branchRow[1]));
      if (spine.length >= S.minSpine) cands.push({ i, dir, spine, rooted: true });
    }
    // У площади: от её дальнего края — вглубь квартала.
    const dir: -1 | 1 = plaza.side === 'N' ? -1 : 1;
    for (let j = 0; j < lat.rows; j++) {
      const n = lat.node(i, j);
      if (n.region !== 'city' || !rectsOverlap({ x: n.x, y: n.y, w: w3, h: w3 }, plaza.rect, 1)) continue;
      const spine = walk(i, j, dir, rng.int(S.branchRow[0], S.branchRow[1]) - 1);
      if (spine.length >= S.minSpine - 1) cands.push({ i, dir, spine, rooted: true });
    }
  }
  // Длинные стволы — первыми, при равенстве — в случайном порядке.
  rng.shuffle(cands);
  cands.sort((a, b) => b.spine.length - a.spine.length);
  const count = rng.int(S.spines[0], S.spines[1]);
  const chosen: Cand[] = [];
  for (const c of cands) {
    if (chosen.length >= count) break;
    if (chosen.some((o) => o.dir === c.dir && Math.abs(o.i - c.i) < S.minApart)) continue;
    chosen.push(c);
  }
  // Сторона проспекта, куда не вышло ни одного ствола (там Нексус и КПП), — улица начинается
  // через detachedRow линий решётки от проспекта; к ней ведут переулки.
  for (const dir of [-1, 1] as const) {
    if (chosen.some((c) => c.dir === dir)) continue;
    const alt: Cand[] = [];
    for (const row of S.detachedRow) {
      for (let i = 0; i < lat.cols; i++) {
        const j0 = hLine + dir * row;
        if (j0 < 0 || j0 >= lat.rows || lat.node(i, j0).region !== 'city') continue;
        const spine = walk(i, j0, dir, 1);
        if (spine.length >= 1) alt.push({ i, dir, spine, rooted: false });
      }
    }
    rng.shuffle(alt);
    for (const c of alt) {
      if (chosen.filter((o) => o.dir === dir).length >= 2) break;
      if (chosen.some((o) => o.dir === dir && Math.abs(o.i - c.i) < S.minApart + 2)) continue;
      chosen.push(c);
    }
  }
  const newArtery = (rooted: boolean): Artery => ({ edges: [], nodes: [], width: S.width, rooted });
  const add = (art: Artery, e: LEdge) => {
    const id = idOf(e);
    if (inArtery[id]) return;
    inArtery[id] = 1;
    art.edges.push(id);
    for (const n of [e.a, e.b]) if (!art.nodes.includes(n)) art.nodes.push(n);
  };
  const branchNodes: { node: number; dir: -1 | 1; rooted: boolean }[] = [];
  for (const c of chosen) {
    const art = newArtery(c.rooted);
    for (const e of c.spine) add(art, e);
    const last = c.spine[c.spine.length - 1];
    const end = lat.nodes[c.dir < 0 ? Math.min(last.a, last.b) : Math.max(last.a, last.b)];
    const j = end.j;
    // Ветви вдоль горизонтальной линии в обе стороны.
    for (const dx of [-1, 1]) {
      let i = c.i;
      for (let k = 0; k < S.branchMax; k++) {
        const e = dx < 0 ? lat.hEdge(i - 1, j) : lat.hEdge(i, j);
        if (!usable(e) || inArtery[idOf(e)] || lat.nodes[e.a].onAvenue || lat.nodes[e.b].onAvenue) break;
        add(art, e);
        i += dx;
        if (Math.abs(i - c.i) >= 2) branchNodes.push({ node: j * lat.cols + i, dir: c.dir, rooted: c.rooted });
      }
    }
    arteries.push(art);
  }
  // Улочки поменьше: от ветвей дальше вглубь кварталов.
  const U = S.lanes;
  const laneCols: { i: number; dir: number }[] = [];
  rng.shuffle(branchNodes);
  for (const { node, dir, rooted } of branchNodes) {
    const n = lat.nodes[node];
    if (!rng.chance(U.chance) || laneCols.some((o) => o.dir === dir && Math.abs(o.i - n.i) < U.minApart)) continue;
    const edges = walk(n.i, n.j, dir, U.length[1]);
    if (edges.length < U.length[0]) continue;
    const art: Artery = { edges: [], nodes: [], width: U.width, rooted };
    for (const e of edges) add(art, e);
    laneCols.push({ i: n.i, dir });
    arteries.push(art);
  }
  for (const a of arteries) {
    for (const id of a.edges) {
      const e = lat.edges[id];
      e.carved = true;
      e.tree = true;
      e.artery = true;
      e.width = a.width;
    }
  }

  // Места под здания: вдоль горизонтальных рёбер артерий, по одну сторону от улицы.
  const taken: Rect[] = [];
  const arteryRects = arteries.flatMap((a) => a.edges.map((id) => lat.edgeBounds(lat.edges[id], a.width)));
  const margin = GENERATOR.border + 3;
  const fits = (r: Rect) =>
    r.x >= margin && r.y >= margin && r.x + r.w <= mapW - margin && r.y + r.h <= mapH - margin &&
    !blocked.some((b) => rectsOverlap(r, b, 3)) && !taken.some((b) => rectsOverlap(r, b, 3)) && !arteryRects.some((b) => rectsOverlap(r, b, 1));
  const streetEdges = arteries.flatMap((a) => a.edges);
  /** Случайное место вдоль улицы под шаблон (входом на улицу) или null. */
  const candidate = (tpl: readonly string[], gap: number, edges: readonly number[], r: Rng = rng): Placement | null => {
    const tw = tpl[0].length;
    const th = tpl.length;
    {
      const e = lat.edges[r.pick(edges)];
      const A = lat.nodes[e.a];
      const B = lat.nodes[e.b];
      const before = r.chance(0.5);
      let rect: Rect;
      let face: Placement['face'];
      if (e.horizontal) {
        const x = r.int(Math.min(A.x, B.x) - (tw >> 1), Math.max(A.x, B.x));
        rect = before ? { x, y: Math.min(A.y, B.y) - gap - th, w: tw, h: th } : { x, y: Math.max(A.y, B.y) + e.width + gap, w: tw, h: th };
        face = before ? 'S' : 'N';
      } else {
        // Вдоль вертикальной улицы шаблон повёрнут: ширина и высота меняются местами.
        const y = r.int(Math.min(A.y, B.y) - (tw >> 1), Math.max(A.y, B.y));
        rect = before ? { x: Math.min(A.x, B.x) - gap - th, y, w: th, h: tw } : { x: Math.max(A.x, B.x) + e.width + gap, y, w: th, h: tw };
        face = before ? 'E' : 'W';
      }
      return fits(rect) ? { rect, face } : null;
    }
  };
  const place = (tpl: readonly string[], n: number, gap: number, tries: number): Placement[] => {
    const out: Placement[] = [];
    for (let t = 0; t < tries && out.length < n && streetEdges.length; t++) {
      const p = candidate(tpl, gap, streetEdges);
      if (!p) continue;
      taken.push(p.rect);
      out.push(p);
    }
    return out;
  };
  const avenueNodes = lat.nodes.filter((n) => n.onAvenue && n.j === hLine);
  const toAvenue = (r: Rect) => Math.min(...avenueNodes.map((n) => Math.hypot(n.x - (r.x + r.w / 2), n.y - (r.y + r.h / 2))));
  // Штаб ГСР — как можно ближе к главному проспекту (вдоль ствола улицы от него).
  const HQ = GENERATOR.cwuHq;
  let hq: Placement | null = null;
  let hqD = HQ.maxDist + Math.max(CWU_HQ_TEMPLATE.length, CWU_HQ_TEMPLATE[0].length) * 8;
  for (let t = 0; t < HQ.tries && streetEdges.length && avenueNodes.length; t++) {
    const p = candidate(CWU_HQ_TEMPLATE, HQ.gap, streetEdges);
    if (!p) continue;
    const d = toAvenue(p.rect);
    if (d < hqD) {
      hq = p;
      hqD = d;
    }
  }
  if (hq) taken.push(hq.rect);
  const D = GENERATOR.dorms;
  const V = GENERATOR.villas;
  const dorms = place(DORM_TEMPLATE, rng.int(D.count[0], D.count[1]), D.gap, D.tries);
  const villas = place(VILLA_TEMPLATE, rng.int(V.count[0], V.count[1]), V.gap, V.tries);

  // Склад Альянса — последним и на своём генераторе (fork не сдвигает общий — штаб, общежития и
  // особняки остаются где были): на окраине, у улицы, которая начинается у проспекта (не переулок,
  // не отдельная улица, к которой ведут переулки), — из мест вдоль таких улиц самое далёкое от проспекта.
  const AR = GENERATOR.arsenal;
  const arng = rng.fork(0xa75e);
  const rootedEdges = arteries.filter((a) => a.rooted).flatMap((a) => a.edges);
  let arsenal: Placement | null = null;
  let arsenalD = -1;
  for (let t = 0; t < AR.tries && rootedEdges.length && avenueNodes.length; t++) {
    const p = candidate(ARSENAL_TEMPLATE, AR.gap, rootedEdges, arng);
    if (!p) continue;
    const d = toAvenue(p.rect);
    if (d > arsenalD) {
      arsenal = p;
      arsenalD = d;
    }
  }
  if (arsenal) taken.push(arsenal.rect);

  // Здания — пустоты решётки: лабиринт туда не заходит.
  const w = GENERATOR.alley.mainWidth;
  for (const p of [...dorms, ...villas, ...(hq ? [hq] : []), ...(arsenal ? [arsenal] : [])]) {
    for (const nd of lat.nodes) if (rectsOverlap({ x: nd.x, y: nd.y, w, h: w }, p.rect, 2)) nd.region = 'void';
    lat.edges.forEach((e, id) => {
      if (!inArtery[id] && rectsOverlap(lat.edgeBounds(e), p.rect, 1)) e.valid = false;
    });
  }
  return { arteries, dorms, villas, hq, arsenal };
}

/** Асфальт артерий поверх вырезанных переулков. Возвращает прямоугольники каждой артерии. */
export function carveArteries(g: GenGrid, lat: Lattice, plan: StreetPlan): Rect[][] {
  return plan.arteries.map((a) => {
    const w = a.width;
    const rects: Rect[] = [];
    for (const id of a.edges) {
      const e = lat.edges[id];
      const A = lat.nodes[e.a];
      const B = lat.nodes[e.b];
      const k = e.kink;
      if (e.horizontal) {
        rects.push({ x: A.x, y: A.y, w: k - A.x + w, h: w }, { x: k, y: Math.min(A.y, B.y), w, h: Math.abs(B.y - A.y) + w }, { x: k, y: B.y, w: B.x - k + w, h: w });
      } else {
        rects.push({ x: A.x, y: A.y, w, h: k - A.y + w }, { x: Math.min(A.x, B.x), y: k, w: Math.abs(B.x - A.x) + w, h: w }, { x: B.x, y: k, w, h: B.y - k + w });
      }
    }
    for (const n of a.nodes) {
      const nd = lat.nodes[n];
      if (!nd.onAvenue) rects.push({ x: nd.x, y: nd.y, w, h: w });
    }
    for (const r of rects) g.fillRect(r, T.STREET);
    return rects;
  });
}
