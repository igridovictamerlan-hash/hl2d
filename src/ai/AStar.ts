import type { NavGrid } from '../world/NavGrid';
import { MinHeap } from '../core/MinHeap';
import { AI } from '../config/ai';

export interface PathOptions {
  /** id зон, которых стоит избегать (множитель стоимости avoidCost, по умолчанию AI.avoidZoneCost). */
  avoidZones?: ReadonlySet<number>;
  avoidCost?: number;
  /** Доп. стоимость входа в якорь (например, обход стоящего персонажа). */
  extraCost?: (anchor: number) => number;
  /** Цена людного места (карта толпы, systems/Crowd.ts): как extraCost, но путь спрямляется как обычно. */
  crowdCost?: (anchor: number) => number;
  /** Закрытые якоря (режимный объект без пропуска): снаружи в них не входят, изнутри — выходят. */
  blocked?: (anchor: number) => boolean;
  maxNodes?: number;
  /**
   * Вес эвристики (≥ 1): больше 1 — «жадный» A*, раскрывает в разы меньше узлов, путь длиннее не больше чем во столько
   * раз. Дальним от игрока NPC (config/population.ts, LOD.paths.weight) — их путей не видно.
   */
  weight?: number;
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
  /** Обход кармана цели (pocket): свои метки и очередь. */
  private readonly pSeen: Uint32Array;
  private readonly pQueue = new Int32Array(AI.pathPocketMax);
  private pGen = 0;
  /** Сколько узлов раскрыл последний поиск (для отладки). */
  lastExpanded = 0;
  /** Отказов по карману цели (для замеров). */
  pocketFails = 0;

  constructor(private readonly nav: NavGrid) {
    const n = nav.w * nav.h;
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.pSeen = new Uint32Array(n);
  }

  /**
   * Цель в замкнутом кармане, куда из start не попасть: обход в обратную сторону от цели (кто может шагнуть в узел),
   * не больше pathPocketMax якорей. true — карман исчерпан, start в нём нет (пути нет); false — дошли до start или
   * карман больше предела (неизвестно). Правило «в закрытое снаружи не входят» — то же, что в find: шаг u→v есть,
   * если u закрыт или v открыт.
   */
  private pocket(goal: number, start: number, blocked: ((anchor: number) => boolean) | undefined): boolean {
    const nav = this.nav;
    const w = nav.w;
    const gen = ++this.pGen;
    const seen = this.pSeen;
    const q = this.pQueue;
    let head = 0;
    let tail = 0;
    seen[goal] = gen;
    q[tail++] = goal;
    while (head < tail) {
      const v = q[head++];
      const vx = v % w;
      const vy = (v - vx) / w;
      const closedV = !!blocked && blocked(v);
      for (let k = 0; k < 8; k++) {
        const ux = vx + DX[k];
        const uy = vy + DY[k];
        if (!nav.isWalkable(ux, uy)) continue;
        if (k >= 4 && (!nav.isWalkable(vx + DX[k], vy) || !nav.isWalkable(vx, vy + DY[k]))) continue;
        const u = uy * w + ux;
        if (seen[u] === gen) continue;
        if (closedV && !blocked!(u)) continue;
        if (u === start || tail >= q.length) return false;
        seen[u] = gen;
        q[tail++] = u;
      }
    }
    return true;
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
    const avoidCost = opts.avoidCost ?? AI.avoidZoneCost;
    const extra = opts.extraCost;
    const crowd = opts.crowdCost;
    const blocked = opts.blocked;
    if (blocked && blocked(goal) && !blocked(start)) return null;
    const maxNodes = opts.maxNodes ?? AI.pathMaxNodes;
    const hw = opts.weight ?? 1;
    const heur = (i: number) => {
      const x = i % w;
      const dx = Math.abs(x - gx);
      const dy = Math.abs((i - x) / w - gy);
      return hw * (dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx);
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
      // Поиск затянулся — не в замкнутом ли кармане цель (один раз за поиск).
      if (expanded === AI.pathPocketAfter && this.pocket(goal, start, blocked)) {
        this.lastExpanded = expanded;
        this.pocketFails++;
        return null;
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const inside = !!blocked && blocked(cur);
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (!nav.isWalkable(nx, ny)) continue;
        // Диагональ — только если оба прямых соседа проходимы (не режем углы).
        if (k >= 4 && (!nav.isWalkable(cx + DX[k], cy) || !nav.isWalkable(cx, cy + DY[k]))) continue;
        const n = ny * w + nx;
        if (this.closed[n] === gen) continue;
        if (blocked && !inside && blocked(n)) continue;
        let step = (k >= 4 ? SQRT2 : 1) * nav.cost[n];
        if (avoid && n !== goal && avoid.has(nav.zone[n])) step *= avoidCost;
        if (extra) step += extra(n);
        if (crowd) step += crowd(n);
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
