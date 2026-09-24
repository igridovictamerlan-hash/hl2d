import type { NavGrid } from '../world/NavGrid';
import { MinHeap } from '../core/MinHeap';
import { AI } from '../config/ai';

export interface PathOptions {
  /** id зон, которых стоит избегать (множитель стоимости AI.avoidZoneCost). */
  avoidZones?: ReadonlySet<number>;
  /** Доп. стоимость входа в якорь (например, обход стоящего персонажа). */
  extraCost?: (anchor: number) => number;
  maxNodes?: number;
}

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * A* по якорям 2×2 (учитывает радиус кружка), 8 направлений без срезания углов,
 * эвристика — октильное расстояние. Массивы переиспользуются между поисками (счётчик поколений).
 */
export class AStar {
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap = new MinHeap(4096);
  private gen = 0;
  /** Сколько узлов раскрыл последний поиск (для отладки). */
  lastExpanded = 0;

  constructor(private readonly nav: NavGrid) {
    const n = nav.w * nav.h;
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /** Путь из якорей от start до goal (включительно) или null. */
  find(start: number, goal: number, opts: PathOptions = {}): number[] | null {
    const nav = this.nav;
    if (start < 0 || goal < 0 || !nav.walk[start] || !nav.walk[goal]) return null;
    if (start === goal) return [start];
    const gen = ++this.gen;
    const w = nav.w;
    const gx = goal % w;
    const gy = (goal - gx) / w;
    const avoid = opts.avoidZones;
    const extra = opts.extraCost;
    const maxNodes = opts.maxNodes ?? AI.pathMaxNodes;
    const heur = (i: number) => {
      const x = i % w;
      const dx = Math.abs(x - gx);
      const dy = Math.abs((i - x) / w - gy);
      return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
    };
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.seen[start] = gen;
    this.parent[start] = -1;
    heap.push(start, heur(start));
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) break;
      if (++expanded > maxNodes) {
        this.lastExpanded = expanded;
        return null;
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (!nav.isWalkable(nx, ny)) continue;
        // Диагональ — только если оба прямых соседа проходимы (не режем углы).
        if (k >= 4 && (!nav.isWalkable(cx + DX[k], cy) || !nav.isWalkable(cx, cy + DY[k]))) continue;
        const n = ny * w + nx;
        if (this.closed[n] === gen) continue;
        let step = (k >= 4 ? SQRT2 : 1) * nav.cost[n];
        if (avoid && n !== goal && avoid.has(nav.zone[n])) step *= AI.avoidZoneCost;
        if (extra) step += extra(n);
        const ng = this.g[cur] + step;
        if (this.seen[n] !== gen || ng < this.g[n]) {
          this.seen[n] = gen;
          this.g[n] = ng;
          this.parent[n] = cur;
          heap.push(n, ng + heur(n));
        }
      }
    }
    this.lastExpanded = expanded;
    if (this.closed[goal] !== gen) return null;
    const path: number[] = [];
    for (let i = goal; i !== -1; i = this.parent[i]) path.push(i);
    return path.reverse();
  }
}
