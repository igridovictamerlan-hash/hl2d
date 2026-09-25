import type { NavGrid } from '../world/NavGrid';
import type { GameMap } from '../world/GameMap';
import { AStar, type PathOptions } from './AStar';
import { smoothPath } from './smoothing';
import { CHARACTER } from '../config/entities';
import { AI } from '../config/ai';
import type { Vec2 } from '../core/math';

export type PathStatus = 'pending' | 'done' | 'failed' | 'cancelled';

export class PathRequest {
  status: PathStatus = 'pending';
  /** Сглаженный путь в пикселях мира (первая точка — текущая позиция). */
  points: Vec2[] = [];

  constructor(
    readonly fromX: number,
    readonly fromY: number,
    readonly goal: number,
    readonly opts: PathOptions,
  ) {}

  cancel(): void {
    if (this.status === 'pending') this.status = 'cancelled';
  }
}

/**
 * Очередь запросов пути: за тик обрабатывается не больше AI.pathBudgetPerTick поисков,
 * чтобы 20+ NPC, одновременно выбравшие цель, не давали рывок кадра.
 */
export class PathService {
  private readonly astar: AStar;
  private queue: PathRequest[] = [];

  constructor(
    private readonly map: GameMap,
    private readonly nav: NavGrid,
  ) {
    this.astar = new AStar(nav);
  }

  get pending(): number {
    return this.queue.length;
  }

  request(fromX: number, fromY: number, goal: number, opts: PathOptions = {}): PathRequest {
    const req = new PathRequest(fromX, fromY, goal, opts);
    this.queue.push(req);
    return req;
  }

  process(budget = AI.pathBudgetPerTick): void {
    let done = 0;
    while (this.queue.length > 0 && done < budget) {
      const req = this.queue.shift()!;
      if (req.status !== 'pending') continue;
      this.solve(req);
      done++;
    }
  }

  /** Синхронный поиск (тесты, отладка). */
  findNow(fromX: number, fromY: number, goal: number, opts: PathOptions = {}): Vec2[] | null {
    const req = new PathRequest(fromX, fromY, goal, opts);
    this.solve(req);
    return req.status === 'done' ? req.points : null;
  }

  private solve(req: PathRequest): void {
    const nav = this.nav;
    const start = nav.nearestWalkable(req.fromX, req.fromY);
    // Между городом и канализацией пути нет (только люки) — не перебираем всю карту зря.
    const sameLevel = start >= 0 && req.goal >= 0 && nav.level[start] === nav.level[req.goal];
    const anchors = sameLevel ? this.astar.find(start, req.goal, req.opts) : null;
    if (!anchors) {
      req.status = 'failed';
      return;
    }
    const pts: Vec2[] = [{ x: req.fromX, y: req.fromY }];
    for (const a of anchors) pts.push({ x: nav.worldX(a), y: nav.worldY(a) });
    req.points = smoothPath(this.map, pts, CHARACTER.radius);
    req.status = 'done';
  }
}
