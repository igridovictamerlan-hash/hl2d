import type { Rng } from '../../core/rng';
import { rectsOverlap, type Rect } from '../../core/math';
import { GENERATOR } from '../../config/generator';
import { T } from '../tiles';
import type { GenGrid } from './GenGrid';

/**
 * Решётка узлов с «дрожанием» и лабиринт на её рёбрах.
 * Узел — левый верхний угол квадрата перекрёстка. Ребро вырезается Z-образно:
 * прямой участок → поворот 90° → прямой участок; излом перекрывает обзор вдоль переулка.
 */

export type Region = 'city' | 'restricted' | 'void';
export type District = 'residential' | 'industrial' | 'restricted';

export interface LNode {
  i: number;
  j: number;
  x: number;
  y: number;
  region: Region;
  /** Узел лежит на магистрали — он уже связан с соседями по магистрали. */
  onAvenue: boolean;
}

export interface LEdge {
  a: number;
  b: number;
  horizontal: boolean;
  /** Можно вырезать (узлы в одном регионе, не задевает штампы). */
  valid: boolean;
  /** Ребро вдоль магистрали — его роль играет сама магистраль. */
  virtual: boolean;
  carved: boolean;
  tree: boolean;
  width: number;
  /** Координата излома: x для горизонтальных рёбер, y — для вертикальных. */
  kink: number;
  district: District;
}

export class Lattice {
  readonly nodes: LNode[] = [];
  readonly edges: LEdge[] = [];
  readonly nodeEdges: number[][] = [];
  private readonly hIndex: number[] = [];
  private readonly vIndex: number[] = [];

  constructor(
    readonly xs: number[],
    readonly ys: number[],
  ) {}

  get cols(): number {
    return this.xs.length;
  }

  get rows(): number {
    return this.ys.length;
  }

  node(i: number, j: number): LNode {
    return this.nodes[j * this.cols + i];
  }

  /** Горизонтальное ребро (i,j)–(i+1,j). */
  hEdge(i: number, j: number): LEdge | undefined {
    if (i < 0 || i >= this.cols - 1 || j < 0 || j >= this.rows) return undefined;
    return this.edges[this.hIndex[j * this.cols + i]];
  }

  /** Вертикальное ребро (i,j)–(i,j+1). */
  vEdge(i: number, j: number): LEdge | undefined {
    if (i < 0 || i >= this.cols || j < 0 || j >= this.rows - 1) return undefined;
    return this.edges[this.vIndex[j * this.cols + i]];
  }

  other(e: LEdge, n: number): number {
    return e.a === n ? e.b : e.a;
  }

  carvedDegree(n: number): number {
    let d = 0;
    for (const id of this.nodeEdges[n]) if (this.edges[id].carved || this.edges[id].virtual) d++;
    return d;
  }

  /** Строит узлы с дрожанием: соседи на одной линии смещены минимум на minJog. */
  static build(rng: Rng, xs: number[], ys: number[]): Lattice {
    const L = GENERATOR.lattice;
    const lat = new Lattice(xs, ys);
    const cols = xs.length;
    const rows = ys.length;
    const jitterLine = (count: number): number[] => {
      const out: number[] = [];
      for (let k = 0; k < count; k++) {
        const opts: number[] = [];
        for (let v = -L.jitter; v <= L.jitter; v++) {
          if (k === 0 || Math.abs(v - out[k - 1]) >= L.minJog) opts.push(v);
        }
        out.push(rng.pick(opts));
      }
      return out;
    };
    const jx = xs.map(() => jitterLine(rows)); // jx[i][j] — вдоль вертикальной линии i
    const jy = ys.map(() => jitterLine(cols)); // jy[j][i] — вдоль горизонтальной линии j
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        lat.nodes.push({ i, j, x: xs[i] + jx[i][j], y: ys[j] + jy[j][i], region: 'city', onAvenue: false });
        lat.nodeEdges.push([]);
      }
    }
    const addEdge = (a: number, b: number, horizontal: boolean): number => {
      const id = lat.edges.length;
      lat.edges.push({
        a, b, horizontal, valid: true, virtual: false, carved: false, tree: false,
        width: GENERATOR.alley.mainWidth, kink: 0, district: 'residential',
      });
      lat.nodeEdges[a].push(id);
      lat.nodeEdges[b].push(id);
      return id;
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const n = j * cols + i;
        lat.hIndex[n] = i < cols - 1 ? addEdge(n, n + 1, true) : -1;
        lat.vIndex[n] = j < rows - 1 ? addEdge(n, n + cols, false) : -1;
      }
    }
    return lat;
  }

  /** Прямоугольник, который может занять ребро (оба квадрата узлов + излом). */
  edgeBounds(e: LEdge, w = GENERATOR.alley.mainWidth): Rect {
    const A = this.nodes[e.a];
    const B = this.nodes[e.b];
    const x0 = Math.min(A.x, B.x);
    const y0 = Math.min(A.y, B.y);
    return { x: x0, y: y0, w: Math.max(A.x, B.x) - x0 + w, h: Math.max(A.y, B.y) - y0 + w };
  }
}

/**
 * Лабиринт «растущее дерево» (случайное блуждание с возвратом + доля Прима).
 * Старт — все узлы магистралей сразу: дерево прорастает от проспекта вглубь кварталов.
 */
export function growMaze(lat: Lattice, rng: Rng, starts: number[]): void {
  const bias = GENERATOR.maze.newestBias;
  const visited = new Uint8Array(lat.nodes.length);
  const active: number[] = [];
  const open = (n: number) => {
    visited[n] = 1;
    active.push(n);
  };
  const run = () => {
    while (active.length > 0) {
      const k = rng.chance(bias) ? active.length - 1 : rng.int(0, active.length - 1);
      const cur = active[k];
      const options: number[] = [];
      for (const id of lat.nodeEdges[cur]) {
        const e = lat.edges[id];
        if (e.valid && !e.virtual && !visited[lat.other(e, cur)]) options.push(id);
      }
      if (options.length === 0) {
        active.splice(k, 1);
        continue;
      }
      const e = lat.edges[rng.pick(options)];
      e.carved = true;
      e.tree = true;
      open(lat.other(e, cur));
    }
  };
  for (const s of starts) if (!visited[s] && lat.nodes[s].region !== 'void') open(s);
  run();
  // Остатки, отрезанные штампами, растим отдельно — их соединит проверка связности.
  for (let n = 0; n < lat.nodes.length; n++) {
    if (visited[n] || lat.nodes[n].region === 'void') continue;
    open(n);
    run();
  }
}

/** Дополнительные рёбра поверх дерева — несколько маршрутов между районами. */
export function addLoops(lat: Lattice, rng: Rng): void {
  const D = GENERATOR.districts;
  for (const e of lat.edges) {
    if (!e.valid || e.virtual || e.carved) continue;
    if (rng.chance(D[e.district].loopChance)) e.carved = true;
  }
}

/**
 * Ширина рёбер и положение изломов. Два ограничения:
 *  - прямой участок через узел (от излома предыдущего ребра до излома этого) ≤ maxStraight;
 *  - перемычка излома не должна вставать в створ переулков соседних узлов — иначе излом
 *    продолжает чужой переулок по прямой и перестаёт перекрывать обзор.
 */
export function finalizeEdges(lat: Lattice, rng: Rng): void {
  const G = GENERATOR;
  const maxStraight = G.alley.maxStraight;
  for (const e of lat.edges) {
    if (!e.carved) continue;
    const touchesAvenue = lat.nodes[e.a].onAvenue || lat.nodes[e.b].onAvenue;
    e.width = !touchesAvenue && rng.chance(G.districts[e.district].narrowChance) ? G.alley.narrowWidth : G.alley.mainWidth;
  }
  const active = (i: number, j: number): LNode | null => {
    if (i < 0 || j < 0 || i >= lat.cols || j >= lat.rows) return null;
    const n = lat.nodes[j * lat.cols + i];
    return n.region !== 'void' && lat.carvedDegree(j * lat.cols + i) > 0 ? n : null;
  };
  const place = (e: LEdge, prev: LEdge | undefined) => {
    const A = lat.nodes[e.a];
    const B = lat.nodes[e.b];
    const a = e.horizontal ? A.x : A.y;
    const b = e.horizontal ? B.x : B.y;
    const w = e.width;
    const d = b - a;
    // Жёсткие ограничения: каждый сегмент и прямая через узел A — не длиннее maxStraight.
    let lo = Math.max(a + 1, b + w - maxStraight);
    let hi = Math.min(b - w, a + maxStraight - w);
    if (prev && prev.carved) hi = Math.min(hi, prev.kink + maxStraight - Math.max(w, prev.width));
    if (hi < lo) hi = lo;
    // Створы переулков соседних узлов (поперёк ребра), в которые нельзя ставить перемычку.
    const forbidden: [number, number][] = [];
    const neighbours = e.horizontal
      ? [A, B, active(A.i, A.j - 1), active(A.i, A.j + 1), active(B.i, B.j - 1), active(B.i, B.j + 1)]
      : [A, B, active(A.i - 1, A.j), active(A.i + 1, A.j), active(B.i - 1, B.j), active(B.i + 1, B.j)];
    for (const n of neighbours) {
      if (!n) continue;
      // Для горизонтального ребра перемычка вертикальна — избегаем столбцов вертикальных переулков.
      const c = e.horizontal ? n.x : n.y;
      forbidden.push([c - w, c + G.alley.mainWidth]);
    }
    const allowed: number[] = [];
    const weights: number[] = [];
    const mid = a + d / 2 - w / 2;
    for (let k = lo; k <= hi; k++) {
      if (forbidden.some(([f0, f1]) => k >= f0 && k <= f1)) continue;
      allowed.push(k);
      // Ближе к середине ребра — вероятнее (излом «в середине квартала»).
      weights.push(1 / (1 + Math.abs(k - mid)));
    }
    if (allowed.length === 0) {
      e.kink = rng.int(lo, hi);
      return;
    }
    let r = rng.next() * weights.reduce((x, y) => x + y, 0);
    let pick = allowed[allowed.length - 1];
    for (let k = 0; k < allowed.length; k++) {
      r -= weights[k];
      if (r <= 0) {
        pick = allowed[k];
        break;
      }
    }
    e.kink = pick;
  };
  for (let j = 0; j < lat.rows; j++) {
    for (let i = 0; i < lat.cols - 1; i++) {
      const e = lat.hEdge(i, j)!;
      if (e.carved) place(e, lat.hEdge(i - 1, j));
    }
  }
  for (let i = 0; i < lat.cols; i++) {
    for (let j = 0; j < lat.rows - 1; j++) {
      const e = lat.vEdge(i, j)!;
      if (e.carved) place(e, lat.vEdge(i, j - 1));
    }
  }
}

/** Вырезает переулки в сетке. Возвращает число тупиков (узлов со степенью 1). */
export function carveLattice(g: GenGrid, lat: Lattice): { deadEnds: number; narrow: number } {
  let narrow = 0;
  for (const e of lat.edges) {
    if (!e.carved) continue;
    if (e.width === GENERATOR.alley.narrowWidth) narrow++;
    const A = lat.nodes[e.a];
    const B = lat.nodes[e.b];
    const w = e.width;
    const k = e.kink;
    if (e.horizontal) {
      g.carveRect({ x: A.x, y: A.y, w: k - A.x + w, h: w }, T.FLOOR);
      g.carveRect({ x: k, y: Math.min(A.y, B.y), w, h: Math.abs(B.y - A.y) + w }, T.FLOOR);
      g.carveRect({ x: k, y: B.y, w: B.x - k + w, h: w }, T.FLOOR);
    } else {
      g.carveRect({ x: A.x, y: A.y, w, h: k - A.y + w }, T.FLOOR);
      g.carveRect({ x: Math.min(A.x, B.x), y: k, w: Math.abs(B.x - A.x) + w, h: w }, T.FLOOR);
      g.carveRect({ x: B.x, y: k, w, h: B.y - k + w }, T.FLOOR);
    }
  }
  let deadEnds = 0;
  for (let n = 0; n < lat.nodes.length; n++) {
    const node = lat.nodes[n];
    if (node.region === 'void' || node.onAvenue) continue;
    let wmax = 0;
    for (const id of lat.nodeEdges[n]) if (lat.edges[id].carved) wmax = Math.max(wmax, lat.edges[id].width);
    if (wmax === 0) continue;
    g.carveRect({ x: node.x, y: node.y, w: wmax, h: wmax }, T.FLOOR);
    if (lat.carvedDegree(n) === 1) deadEnds++;
  }
  return { deadEnds, narrow };
}

/** Размечает регионы узлов и допустимость рёбер относительно штампов. */
export function assignRegions(
  lat: Lattice,
  opts: {
    restricted: Rect;
    restrictedInner: Rect;
    voids: Rect[];
    industrial: Rect;
  },
): void {
  const w = GENERATOR.alley.mainWidth;
  const inside = (outer: Rect, r: Rect) =>
    r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
  for (const n of lat.nodes) {
    const sq = { x: n.x, y: n.y, w, h: w };
    if (inside(opts.restrictedInner, sq)) n.region = 'restricted';
    else if (rectsOverlap(sq, opts.restricted, 2)) n.region = 'void';
    else if (opts.voids.some((v) => rectsOverlap(sq, v, 2))) n.region = 'void';
    else n.region = 'city';
    // Крупные кварталы-склады: выкидываем каждый второй узел по обеим осям.
    const bigBlocks = n.region === 'restricted' || rectsOverlap(sq, opts.industrial);
    if (bigBlocks && !n.onAvenue && n.i % 2 === 1 && n.j % 2 === 1) n.region = 'void';
  }
  for (const e of lat.edges) {
    const A = lat.nodes[e.a];
    const B = lat.nodes[e.b];
    const bounds = lat.edgeBounds(e);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const mid = { x: cx, y: cy, w: 1, h: 1 };
    e.district = A.region === 'restricted' ? 'restricted' : rectsOverlap(mid, opts.industrial) ? 'industrial' : 'residential';
    if (A.region === 'void' || B.region === 'void' || A.region !== B.region) {
      e.valid = false;
    } else if (A.region === 'restricted') {
      e.valid = inside(opts.restrictedInner, bounds);
    } else {
      e.valid = !rectsOverlap(bounds, opts.restricted, 1) && !opts.voids.some((v) => rectsOverlap(bounds, v, 1));
    }
    if (A.onAvenue && B.onAvenue && (e.horizontal ? A.j === B.j : A.i === B.i)) e.virtual = true;
  }
}
