import { SOLID, T } from './tiles';
import { MinHeap } from '../core/MinHeap';
import type { GenGrid } from './generator/GenGrid';

/**
 * Связность считается не по тайлам, а по «якорям» 2×2: персонаж диаметром 24 px занимает
 * квадрат 2×2 тайла (32 px). Якорь (ax, ay) проходим, если свободны тайлы
 * (ax..ax+1, ay..ay+1). Соседство — 4-связное (диагональ без срезания углов эквивалентна).
 */

export function buildAnchorWalk(tiles: Uint8Array, w: number, h: number): Uint8Array {
  const aw = w - 1;
  const ah = h - 1;
  const walk = new Uint8Array(aw * ah);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = y * w + x;
      walk[y * aw + x] =
        SOLID[tiles[i]] === 0 && SOLID[tiles[i + 1]] === 0 && SOLID[tiles[i + w]] === 0 && SOLID[tiles[i + w + 1]] === 0
          ? 1
          : 0;
    }
  }
  return walk;
}

export interface Components {
  /** Метка компоненты для каждого якоря, -1 — непроходим. */
  labels: Int32Array;
  sizes: number[];
}

export function labelComponents(walk: Uint8Array, aw: number, ah: number): Components {
  const labels = new Int32Array(aw * ah).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(aw * ah);
  for (let s = 0; s < walk.length; s++) {
    if (!walk[s] || labels[s] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    labels[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % aw;
      if (x > 0 && walk[i - 1] && labels[i - 1] === -1) { labels[i - 1] = id; queue[tail++] = i - 1; }
      if (x < aw - 1 && walk[i + 1] && labels[i + 1] === -1) { labels[i + 1] = id; queue[tail++] = i + 1; }
      if (i >= aw && walk[i - aw] && labels[i - aw] === -1) { labels[i - aw] = id; queue[tail++] = i - aw; }
      if (i < aw * (ah - 1) && walk[i + aw] && labels[i + aw] === -1) { labels[i + aw] = id; queue[tail++] = i + aw; }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

/** Проходимые тайлы, которых не касается ни один якорь главной компоненты (туда не пролезть). */
export function findUnreachableTiles(tiles: Uint8Array, w: number, h: number, labels: Int32Array, main: number): number[] {
  const aw = w - 1;
  const covered = new Uint8Array(w * h);
  for (let ay = 0; ay < h - 1; ay++) {
    for (let ax = 0; ax < aw; ax++) {
      if (labels[ay * aw + ax] !== main) continue;
      const i = ay * w + ax;
      covered[i] = covered[i + 1] = covered[i + w] = covered[i + w + 1] = 1;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (SOLID[tiles[i]] === 0 && !covered[i]) out.push(i);
  return out;
}

export interface ConnectivityReport {
  /** Компонент было до исправления. */
  initialComponents: number;
  tunnels: number;
  tunnelTiles: number;
  fragmentsFilled: number;
  unreachableRemoved: number;
  finalComponents: number;
}

/**
 * Делает карту связной: мелкие фрагменты засыпает, крупные соединяет с главной компонентой
 * самым дешёвым тоннелем 2×2 (Дейкстра: проход по существующему полу почти бесплатен).
 * В конце засыпает проходимые тайлы, куда персонаж физически не пролезает.
 */
export function ensureConnectivity(
  g: GenGrid,
  refX: number,
  refY: number,
  opts: { minFragment: number; maxIterations: number },
): ConnectivityReport {
  const { w, h } = g;
  const aw = w - 1;
  const ah = h - 1;
  const report: ConnectivityReport = {
    initialComponents: 0, tunnels: 0, tunnelTiles: 0, fragmentsFilled: 0, unreachableRemoved: 0, finalComponents: 0,
  };
  const refAnchor = Math.min(ah - 1, Math.max(0, refY)) * aw + Math.min(aw - 1, Math.max(0, refX));

  const dist = new Float64Array(aw * ah);
  const prev = new Int32Array(aw * ah);
  const heap = new MinHeap();

  const anchorCost = (ax: number, ay: number): number => {
    // Цена входа в якорь: 1 + 4 за каждую стену, Infinity — если там заблокированная стена.
    let c = 1;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = (ay + dy) * w + ax + dx;
        if (SOLID[g.tiles[i]] === 1) {
          if (g.locked[i]) return Infinity;
          c += 4;
        }
      }
    }
    return c;
  };

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    const walk = buildAnchorWalk(g.tiles, w, h);
    const { labels, sizes } = labelComponents(walk, aw, ah);
    if (iter === 0) report.initialComponents = sizes.length;
    if (sizes.length <= 1) break;
    let main = labels[refAnchor];
    if (main < 0) main = sizes.indexOf(Math.max(...sizes));

    // Берём самый крупный фрагмент, не считая главного.
    let frag = -1;
    for (let c = 0; c < sizes.length; c++) if (c !== main && (frag < 0 || sizes[c] > sizes[frag])) frag = c;

    if (sizes[frag] < opts.minFragment) {
      if (fillComponent(g, labels, frag, main) === 0) break;
      report.fragmentsFilled++;
      continue;
    }

    // Дейкстра от всех якорей фрагмента до любого якоря главной компоненты.
    dist.fill(Infinity);
    prev.fill(-1);
    heap.clear();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === frag) {
        dist[i] = 0;
        heap.push(i, 0);
      }
    }
    let found = -1;
    while (heap.size > 0) {
      const i = heap.pop();
      const d = heap.lastPriority;
      if (d > dist[i]) continue;
      if (labels[i] === main) {
        found = i;
        break;
      }
      const x = i % aw;
      const y = (i - x) / aw;
      const ns: [number, number][] = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of ns) {
        if (nx < 0 || ny < 0 || nx >= aw || ny >= ah) continue;
        const n = ny * aw + nx;
        const c = anchorCost(nx, ny);
        if (c === Infinity) continue;
        const nd = d + c;
        if (nd < dist[n]) {
          dist[n] = nd;
          prev[n] = i;
          heap.push(n, nd);
        }
      }
    }
    if (found < 0) {
      if (fillComponent(g, labels, frag, main) === 0) break;
      report.fragmentsFilled++;
      continue;
    }
    for (let i = found; i >= 0 && labels[i] !== frag; i = prev[i]) {
      const x = i % aw;
      const y = (i - x) / aw;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (!g.passable(x + dx, y + dy) && g.set(x + dx, y + dy, T.FLOOR)) report.tunnelTiles++;
        }
      }
    }
    report.tunnels++;
  }

  // Финал: проходимые тайлы вне досягаемости → стена.
  const walk = buildAnchorWalk(g.tiles, w, h);
  const comps = labelComponents(walk, aw, ah);
  let main = comps.labels[refAnchor];
  if (main < 0) main = comps.sizes.indexOf(Math.max(...comps.sizes));
  for (const i of findUnreachableTiles(g.tiles, w, h, comps.labels, main)) {
    if (!g.locked[i]) {
      g.tiles[i] = T.WALL;
      report.unreachableRemoved++;
    }
  }
  const finalWalk = buildAnchorWalk(g.tiles, w, h);
  report.finalComponents = labelComponents(finalWalk, aw, ah).sizes.length;
  return report;
}

/** Засыпает фрагмент стеной (кроме тайлов главной компоненты и заблокированных). Возвращает число изменённых тайлов. */
function fillComponent(g: GenGrid, labels: Int32Array, comp: number, main: number): number {
  const aw = g.w - 1;
  const keep = new Uint8Array(g.w * g.h);
  let changed = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== main) continue;
    const x = i % aw;
    const y = (i - x) / aw;
    const t = y * g.w + x;
    keep[t] = keep[t + 1] = keep[t + g.w] = keep[t + g.w + 1] = 1;
  }
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== comp) continue;
    const x = i % aw;
    const y = (i - x) / aw;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const t = (y + dy) * g.w + x + dx;
        if (!keep[t] && !g.locked[t] && SOLID[g.tiles[t]] === 0) {
          g.tiles[t] = T.WALL;
          changed++;
        }
      }
    }
  }
  return changed;
}
