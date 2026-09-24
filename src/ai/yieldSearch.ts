import type { NavGrid } from '../world/NavGrid';
import { dist, pointPolylineDist, type Vec2 } from '../core/math';

/**
 * Поиск «кармана», куда можно отступить, чтобы пропустить встречного в узком проходе.
 * BFS по якорям от своей позиции: подходит якорь, достаточно далёкий от пути встречного.
 */
export class AnchorBfs {
  private readonly mark: Uint32Array;
  private readonly parent: Int32Array;
  private readonly queue: Int32Array;
  private gen = 0;

  constructor(private readonly nav: NavGrid) {
    const n = nav.w * nav.h;
    this.mark = new Uint32Array(n);
    this.parent = new Int32Array(n);
    this.queue = new Int32Array(n);
  }

  /**
   * BFS от start. blocked — куда нельзя (через встречного не пройти), accept — цель найдена.
   * Если цели нет, возвращает лучший по score из осмотренных (если score задан).
   */
  search(
    start: number,
    maxNodes: number,
    blocked: (i: number) => boolean,
    accept: (i: number) => boolean,
    score?: (i: number) => number,
  ): number[] | null {
    const nav = this.nav;
    const w = nav.w;
    const gen = ++this.gen;
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.mark[start] = gen;
    this.parent[start] = -1;
    let best = -1;
    let bestScore = -Infinity;
    while (head < tail && tail < maxNodes) {
      const cur = this.queue[head++];
      if (cur !== start && accept(cur)) return this.trace(cur);
      if (score) {
        const s = score(cur);
        if (s > bestScore) {
          bestScore = s;
          best = cur;
        }
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const ns = [cur - 1, cur + 1, cur - w, cur + w];
      const ok = [cx > 0, cx < w - 1, cy > 0, cy < nav.h - 1];
      for (let k = 0; k < 4; k++) {
        const n = ns[k];
        if (!ok[k] || this.mark[n] === gen || !nav.walk[n] || blocked(n)) continue;
        this.mark[n] = gen;
        this.parent[n] = cur;
        this.queue[tail++] = n;
      }
    }
    return best >= 0 && best !== start ? this.trace(best) : null;
  }

  private trace(end: number): number[] {
    const out: number[] = [];
    for (let i = end; i !== -1; i = this.parent[i]) out.push(i);
    return out.reverse();
  }
}

export interface YieldSpot {
  points: Vec2[];
  steps: number;
}

/**
 * Карман рядом: якорь не ближе clearance к пути встречного (otherPath) и к нему самому.
 * backOff — если кармана нет, отступить как можно дальше от встречного.
 */
export function findYieldSpot(
  nav: NavGrid,
  bfs: AnchorBfs,
  from: Vec2,
  otherPos: Vec2,
  otherPath: readonly Vec2[],
  opts: { clearance: number; maxNodes: number; backOff: boolean },
): YieldSpot | null {
  const start = nav.nearestWalkable(from.x, from.y);
  if (start < 0) return null;
  const px = (i: number) => nav.worldX(i);
  const py = (i: number) => nav.worldY(i);
  const blockRadius = 22;
  const path = bfs.search(
    start,
    opts.maxNodes,
    (i) => dist(px(i), py(i), otherPos.x, otherPos.y) < blockRadius,
    (i) =>
      pointPolylineDist(px(i), py(i), otherPath) >= opts.clearance &&
      dist(px(i), py(i), otherPos.x, otherPos.y) >= opts.clearance + 4,
    opts.backOff ? (i) => dist(px(i), py(i), otherPos.x, otherPos.y) - 0.1 * dist(px(i), py(i), from.x, from.y) : undefined,
  );
  if (!path || path.length < 2) return null;
  return { points: path.map((i) => ({ x: px(i), y: py(i) })), steps: path.length - 1 };
}
