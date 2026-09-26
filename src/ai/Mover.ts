import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { PathRequest } from './PathService';
import { findYieldSpot, type YieldSpot } from './yieldSearch';
import { circleHitsSolid } from '../world/collision';
import { AI } from '../config/ai';
import { FACTIONS } from '../config/factions';
import { clamp, dist, lerp, pointPolylineDist, type Vec2 } from '../core/math';

export type MoveStatus = 'idle' | 'pending' | 'moving' | 'arrived' | 'failed';

const near: Character[] = [];

/** Приоритет в узком проходе: игрок > OTA > ГО > ГСР > граждане. */
const priority = (c: Character) => (c.isPlayer ? 100 : FACTIONS[c.faction].yieldPriority);

/**
 * Передвижение NPC: запрос пути, следование по нему, объезд встречных «по правилу правой руки»,
 * распознавание блокировки и уступание дороги в узких проходах:
 *  - встречные лоб в лоб: уступает младший по приоритету, при равенстве — тот, кому ближе до «кармана»;
 *  - стоящего NPC просят отойти в сторону;
 *  - стоящего игрока NPC ждёт, потом разворачивается (статус failed → мозг выберет новую цель);
 *  - упёрся в стену без причины — перестраивает путь.
 */
export class Mover {
  status: MoveStatus = 'idle';
  avoidZones: ReadonlySet<number> | undefined;
  /** Целевой якорь, -1 — нет цели. */
  goal = -1;
  path: Vec2[] = [];
  wp = 0;
  /** Кто сейчас мешает (для отладки). */
  blocker: Character | null = null;
  /** Кого пропускаем. */
  yieldFrom: Character | null = null;

  private req: PathRequest | null = null;
  private repaths = 0;
  private avgSpeed = 0;
  private blockedTime = 0;
  private stuckTime = 0;
  private waitTime = 0;
  private yieldPts: Vec2[] = [];
  private yieldWp = 0;
  private yieldTime = 0;
  /** Сторож затора: где стояли в начале окна и сколько секунд не отошли оттуда. */
  private spotX = 0;
  private spotY = 0;
  private noProgress = 0;

  constructor(public speed: number) {}

  goTo(self: Character, ctx: AiContext, goal: number): void {
    this.goal = goal;
    this.repaths = 0;
    this.waitTime = 0;
    // Сторож затора не сбрасывается: мозг, заново посылающий к той же цели, не должен его обманывать.
    this.requestPath(self, ctx);
  }

  stop(): void {
    this.req?.cancel();
    this.req = null;
    this.goal = -1;
    this.path = [];
    this.wp = 0;
    this.status = 'idle';
  }

  /** Оставшиеся точки пути — по ним встречные решают, куда отступить. */
  remaining(max: number): Vec2[] {
    return this.status === 'moving' ? this.path.slice(this.wp, this.wp + max) : [];
  }

  /** Направление к текущей точке пути (единичный вектор) или null. */
  heading(self: Character): Vec2 | null {
    if (this.status !== 'moving' || this.wp >= this.path.length) return null;
    const p = this.path[this.wp];
    const d = dist(self.x, self.y, p.x, p.y);
    return d > 0.5 ? { x: (p.x - self.x) / d, y: (p.y - self.y) / d } : null;
  }

  private requestPath(self: Character, ctx: AiContext): void {
    this.req?.cancel();
    this.req = ctx.paths.request(self.x, self.y, this.goal, { avoidZones: this.avoidZones });
    this.status = 'pending';
    this.path = [];
    this.wp = 0;
    this.stuckTime = 0;
    this.blockedTime = 0;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.avgSpeed = lerp(this.avgSpeed, self.moveSpeed, Math.min(1, dt * 5));
    if (this.watchdog(self, ctx, dt)) return;
    if (this.yieldFrom) {
      this.updateYield(self, ctx, dt);
      return;
    }
    switch (this.status) {
      case 'pending': {
        self.wantX = self.wantY = 0;
        const req = this.req;
        if (!req || req.status === 'failed' || req.status === 'cancelled') this.status = 'failed';
        else if (req.status === 'done') {
          this.path = req.points;
          this.wp = Math.min(1, this.path.length - 1);
          this.status = 'moving';
          this.avgSpeed = this.speed;
        }
        break;
      }
      case 'moving':
        this.follow(self, ctx, dt);
        break;
      default:
        self.wantX = self.wantY = 0;
    }
  }

  /** Затор: давно топчемся на пятачке, не дойдя до цели, — бросаем её (true — сдались на этом тике). */
  private watchdog(self: Character, ctx: AiContext, dt: number): boolean {
    if (this.goal < 0 || (this.status !== 'moving' && this.status !== 'pending' && !this.yieldFrom)) {
      this.noProgress = 0;
      return false;
    }
    const M = AI.move;
    if (this.noProgress === 0 || dist(self.x, self.y, this.spotX, this.spotY) > M.giveUpProgress) {
      this.spotX = self.x;
      this.spotY = self.y;
      this.noProgress = dt;
      return false;
    }
    const before = this.noProgress;
    this.noProgress += dt;
    // Упёрлись в NPC — ненадолго проходим сквозь (раз в окно).
    if (before < M.ghostAfter && this.noProgress >= M.ghostAfter && self.ghost <= 0) {
      // Мешающий — не только впереди: сосед вплотную сбоку может прижимать к стене или завалу.
      const o = this.blocker ?? this.yieldFrom ?? ctx.entities.near(self.x, self.y, self.radius * 2 + M.ghostContact, near).find((n) => n !== self && n.alive) ?? null;
      if (o && !o.isPlayer) self.ghost = M.ghostTime;
    }
    if (this.noProgress < M.giveUpAfter) return false;
    this.noProgress = 0;
    this.yieldFrom = null;
    this.blocker = null;
    this.req?.cancel();
    this.req = null;
    this.status = 'failed';
    self.wantX = self.wantY = 0;
    return true;
  }

  private follow(self: Character, ctx: AiContext, dt: number): void {
    const M = AI.move;
    const path = this.path;
    while (this.wp < path.length - 1) {
      const p = path[this.wp];
      const d = dist(self.x, self.y, p.x, p.y);
      if (d < M.waypointReach) {
        this.wp++;
        continue;
      }
      // Проскочили точку (например, оттолкнули) — берём следующую.
      const q = path[this.wp + 1];
      if (d < 24 && (self.x - p.x) * (q.x - p.x) + (self.y - p.y) * (q.y - p.y) > 0) {
        this.wp++;
        continue;
      }
      break;
    }
    const target = path[this.wp];
    const last = this.wp === path.length - 1;
    const d = dist(self.x, self.y, target.x, target.y);
    if (last && d < M.arriveRadius) {
      this.status = 'arrived';
      self.wantX = self.wantY = 0;
      return;
    }
    const dx = (target.x - self.x) / (d || 1);
    const dy = (target.y - self.y) / (d || 1);
    const av = this.avoidance(self, dx, dy, ctx);
    let mx = dx + av.x;
    let my = dy + av.y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const sp = this.speed * (last ? clamp(d / 28, 0.35, 1) : 1);
    self.wantX = mx * sp;
    self.wantY = my * sp;

    // Блокировка: движемся заметно медленнее желаемого.
    const slow = this.avgSpeed < this.speed * M.slowFraction;
    const blocker = slow ? (this.findBlocker(self, dx, dy, ctx) ?? this.findContact(self, dx, dy, ctx)) : null;
    this.blocker = blocker;
    if (slow && blocker) {
      this.blockedTime += dt;
      this.stuckTime = 0;
    } else if (slow) {
      this.stuckTime += dt;
      this.blockedTime = Math.max(0, this.blockedTime - dt);
    } else {
      this.blockedTime = 0;
      this.stuckTime = 0;
      this.waitTime = Math.max(0, this.waitTime - dt);
    }
    if (blocker && this.blockedTime > M.blockedToYield) {
      this.blockedTime = 0;
      this.resolveBlock(self, blocker, dx, dy, ctx);
    } else if (this.stuckTime > M.stuckToRepath) {
      this.stuckTime = 0;
      if (++this.repaths > M.maxRepaths) this.status = 'failed';
      else this.requestPath(self, ctx);
    }
  }

  /** Объезд: встречного прямо по курсу обходим справа, остальных — в сторону от них. */
  private avoidance(self: Character, dx: number, dy: number, ctx: AiContext): Vec2 {
    const M = AI.move;
    const rx = -dy;
    const ry = dx;
    let ax = 0;
    let ay = 0;
    for (const o of ctx.entities.near(self.x, self.y, self.radius * 2 + M.avoidRange, near)) {
      if (o === self || !o.alive) continue;
      const ox = o.x - self.x;
      const oy = o.y - self.y;
      const d = Math.hypot(ox, oy);
      if (d < 1e-3) continue;
      const ahead = (ox * dx + oy * dy) / d;
      if (ahead < 0.3) continue;
      const gap = d - self.radius - o.radius;
      if (gap > M.avoidRange) continue;
      const lateral = ox * rx + oy * ry;
      const side = Math.abs(lateral) < 4 ? 1 : lateral > 0 ? -1 : 1;
      let w = M.avoidStrength * (1 - Math.max(0, gap) / M.avoidRange) * ahead;
      // Сбоку стена (узкий проход) — объезжать некуда: идём прямо и просим уступить.
      if (circleHitsSolid(ctx.map, self.x + rx * side * 8, self.y + ry * side * 8, self.radius - 1)) w *= 0.15;
      ax += rx * side * w;
      ay += ry * side * w;
    }
    return { x: ax, y: ay };
  }

  private findBlocker(self: Character, dx: number, dy: number, ctx: AiContext): Character | null {
    let best: Character | null = null;
    let bestD = Infinity;
    for (const o of ctx.entities.near(self.x, self.y, self.radius * 2 + 10, near)) {
      if (o === self || !o.alive) continue;
      const ox = o.x - self.x;
      const oy = o.y - self.y;
      const d = Math.hypot(ox, oy);
      if (d < 1e-3 || (ox * dx + oy * dy) / d < 0.45) continue;
      if (d - self.radius - o.radius > 12) continue;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /**
   * Упираемся, а прямо по курсу никого — возможно, мешает тот, кто касается нас сбоку
   * (например, стоит у входа в узкий проход, куда мы поворачиваем).
   */
  private findContact(self: Character, dx: number, dy: number, ctx: AiContext): Character | null {
    for (const o of ctx.entities.near(self.x, self.y, self.radius * 2 + 4, near)) {
      if (o === self || !o.alive) continue;
      const ox = o.x - self.x;
      const oy = o.y - self.y;
      const d = Math.hypot(ox, oy);
      if (d > 1e-3 && d - self.radius - o.radius < 4 && (ox * dx + oy * dy) / d > -0.3) return o;
    }
    return null;
  }

  private resolveBlock(self: Character, b: Character, dx: number, dy: number, ctx: AiContext): void {
    const M = AI.move;
    if (b.isPlayer) {
      const approaching = b.moveSpeed > 20 && b.vx * (self.x - b.x) + b.vy * (self.y - b.y) > 0;
      if (approaching) {
        this.makeWay(self, b, ctx);
        return;
      }
      this.waitTime += M.blockedToYield;
      if (this.waitTime > M.waitForPlayer) {
        this.waitTime = 0;
        this.status = 'failed';
      }
      return;
    }
    const bm = b.brain?.mover;
    if (!bm || bm.yieldFrom) return; // уже кого-то пропускает — ждём
    const bDir = bm.heading(b);
    if (!bDir) {
      // Стоит на месте — просим отойти; не может — ищем другую дорогу.
      if (!bm.makeWay(b, self, ctx)) {
        this.waitTime += M.blockedToYield;
        if (this.waitTime > 2) {
          this.waitTime = 0;
          this.status = 'failed';
        }
      }
      return;
    }
    if (bDir.x * dx + bDir.y * dy > 0.2) {
      // Идём следом — ждём; если долго, перестраиваем путь.
      this.waitTime += M.blockedToYield;
      if (this.waitTime > 3) {
        this.waitTime = 0;
        this.requestPath(self, ctx);
      }
      return;
    }
    // Встречные лоб в лоб.
    const pa = priority(self);
    const pb = priority(b);
    if (pa !== pb) {
      const [loser, winner] = pa < pb ? [self, b] : [b, self];
      loser.brain?.mover.makeWay(loser, winner, ctx);
      return;
    }
    const mine = this.findSpot(self, b, ctx, false);
    const his = bm.findSpot(b, self, ctx, false);
    if (mine && (!his || mine.steps <= his.steps)) this.beginYield(b, mine);
    else if (his) bm.beginYield(self, his);
    else if (self.id > b.id) this.makeWay(self, b, ctx);
    else bm.makeWay(b, self, ctx);
  }

  findSpot(self: Character, other: Character, ctx: AiContext, backOff: boolean): YieldSpot | null {
    const om = other.brain?.mover;
    const pos = { x: other.x, y: other.y };
    let poly: Vec2[] = [pos];
    if (om && om.status === 'moving') poly = [pos, ...om.remaining(AI.yield.otherPathPoints)];
    else if (other.isPlayer && other.moveSpeed > 20) {
      const k = 200 / other.moveSpeed;
      poly = [pos, { x: other.x + other.vx * k, y: other.y + other.vy * k }];
    }
    return findYieldSpot(ctx.nav, ctx.bfs, self, pos, poly, {
      clearance: AI.yield.clearance,
      maxNodes: AI.yield.searchNodes,
      backOff,
    });
  }

  /** Отойти в сторону, пропуская other. false — отойти некуда. */
  makeWay(self: Character, other: Character, ctx: AiContext): boolean {
    if (this.yieldFrom === other) return true;
    const spot = this.findSpot(self, other, ctx, false) ?? this.findSpot(self, other, ctx, true);
    if (!spot) return false;
    this.beginYield(other, spot);
    return true;
  }

  beginYield(other: Character, spot: YieldSpot): void {
    this.yieldFrom = other;
    this.blocker = other;
    this.yieldPts = spot.points;
    this.yieldWp = 1;
    this.yieldTime = 0;
  }

  /**
   * Встречный больше не мешает: стоит на месте (если загораживает — попросим отойти),
   * либо удаляется и его оставшийся путь проходит достаточно далеко от нас.
   */
  private otherPassed(self: Character, o: Character): boolean {
    const Y = AI.yield;
    const om = o.brain?.mover;
    const moving = o.isPlayer ? o.moveSpeed > 10 : om?.status === 'moving' || om?.status === 'pending';
    if (!moving) return true;
    const approaching = o.vx * (self.x - o.x) + o.vy * (self.y - o.y) > 0 && o.moveSpeed > 10;
    if (approaching) return false;
    if (dist(self.x, self.y, o.x, o.y) > Y.resumeDistance) return true;
    const rest = om ? om.remaining(Y.otherPathPoints) : [];
    return rest.length > 0 && pointPolylineDist(self.x, self.y, [{ x: o.x, y: o.y }, ...rest]) >= Y.clearance;
  }

  private updateYield(self: Character, ctx: AiContext, dt: number): void {
    const Y = AI.yield;
    const o = this.yieldFrom!;
    this.yieldTime += dt;
    const pts = this.yieldPts;
    while (this.yieldWp < pts.length && dist(self.x, self.y, pts[this.yieldWp].x, pts[this.yieldWp].y) < 5) this.yieldWp++;
    if (this.yieldWp < pts.length) {
      const p = pts[this.yieldWp];
      const d = dist(self.x, self.y, p.x, p.y);
      const sp = this.speed * 1.1;
      self.wantX = ((p.x - self.x) / d) * sp;
      self.wantY = ((p.y - self.y) / d) * sp;
    } else {
      self.wantX = self.wantY = 0;
    }
    const reached = this.yieldWp >= pts.length;
    if (!o.alive || this.yieldTime > Y.maxWait || (this.yieldTime > 0.5 && this.otherPassed(self, o) && (reached || this.yieldTime > 1.5))) {
      this.yieldFrom = null;
      this.blocker = null;
      if (this.goal >= 0) this.requestPath(self, ctx);
      else this.status = 'idle';
    }
  }
}
