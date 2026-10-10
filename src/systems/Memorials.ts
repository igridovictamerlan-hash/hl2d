import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/math';
import { hash01 } from '../core/rng';
import { MEMORIALS } from '../config/memorials';
import { TALK } from '../config/talk';
import { FACTIONS } from '../config/factions';
import { displayName } from '../entities/cover';
import { lineOfSight } from '../world/visibility';
import { civilian } from './Senses';
import { fmt } from './Radio';
import { phrase } from './phrases';

/** Памятное место на месте убийства мирного жителя: снимок у стены, цветы, свечи. */
export interface Memorial {
  id: number;
  x: number;
  y: number;
  /** Кого помнят (имя на момент гибели) и его номер человека (Character.pid) — по нему близкие узнают «своего». */
  name: string;
  pid: number;
  /** Когда появилось и до какого времени стоит (каждый приход продлевает). */
  since: number;
  until: number;
  flowers: number;
  candles: number;
  /** От стены наружу (единичный вектор); (0, 1) — стены рядом не нашлось. Только отрисовка и место стоянки. */
  nx: number;
  ny: number;
  /** Сколько раз приходили. */
  visits: number;
}

interface Pending {
  x: number;
  y: number;
  name: string;
  pid: number;
  due: number;
}

interface Visit {
  t: number;
  n: number;
}

/** Стороны якоря: тайлы стены рядом с его квадратом 2×2 и куда смотрит «наружу» (от стены). */
const SIDES: readonly { dx: number; dy: number; nx: number; ny: number }[] = [
  { dx: -1, dy: 0, nx: 1, ny: 0 },
  { dx: 2, dy: 0, nx: -1, ny: 0 },
  { dx: 0, dy: -1, nx: 0, ny: 1 },
  { dx: 0, dy: 2, nx: 0, ny: -1 },
];

/**
 * Памятные места (config/memorials.ts): убит мирный житель (убийца — не из Протектората) в городе — через delay с
 * на месте гибели у стены появляются снимок, цветы и свечи. Близкие погибшего (родня, друзья — Relations.lovesPid)
 * приходят, кладут цветы днём и ставят свечи ночью (CitizenBrain: forVisitor → spot → visit); посетитель
 * получает «поддержку» (настроение), срок места продлевается. О месте ходит слух (Talk). Своя случайность.
 */
export class Memorials {
  enabled = true;
  readonly list: Memorial[] = [];
  readonly stats = { placed: 0, merged: 0, visits: 0, flowers: 0, candles: 0, expired: 0 };
  private readonly pending: Pending[] = [];
  private readonly visited = new WeakMap<Character, Map<number, Visit>>();
  private readonly rng: Rng;
  private nextId = 1;

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x3e30a1);
    ctx.combat.deathListeners.push((c, killer) => this.onDeath(c, killer));
    // Слух о памятном месте — вид в TALK.newsTopics (если его там ещё нет).
    if (!TALK.newsTopics[MEMORIALS.news.kind]) TALK.newsTopics[MEMORIALS.news.kind] = MEMORIALS.topic;
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  // ───────────────────────────── появление ─────────────────────────────

  /** Убит мирный в городе не силовиком — место будет через delay с. */
  private onDeath(c: Character, killer: Character | null): void {
    if (!this.enabled || !killer || killer === c || !civilian(c) || FACTIONS[killer.faction].authority) return;
    const { ctx } = this;
    if (!ctx.war.inCity(c.x, c.y) || ctx.map.levelAt(c.x, c.y) !== 'city') return;
    this.pending.push({ x: c.x, y: c.y, name: displayName(c), pid: c.pid, due: this.now + MEMORIALS.delay });
    if (this.pending.length > MEMORIALS.max * 2) this.pending.shift();
  }

  /** Якорь у стены рядом с точкой (стена — полностью по стороне квадрата 2×2, без дверей) или якорь на месте. */
  private snap(x: number, y: number): { x: number; y: number; nx: number; ny: number } | null {
    const { nav, map } = this.ctx;
    const S = MEMORIALS.snap;
    const home = nav.nearestWalkable(x, y, S.search);
    if (home < 0 || nav.level[home] !== 0) return null;
    const hx = nav.ax(home);
    const hy = nav.ay(home);
    let best: { x: number; y: number; nx: number; ny: number } | null = null;
    let bd = Infinity;
    for (let dy = -S.reach; dy <= S.reach; dy++) {
      for (let dx = -S.reach; dx <= S.reach; dx++) {
        const ax = hx + dx;
        const ay = hy + dy;
        if (!nav.isWalkable(ax, ay)) continue;
        const i = ay * nav.w + ax;
        if (nav.zone[i] !== nav.zone[home]) continue;
        const wx = nav.worldX(i);
        const wy = nav.worldY(i);
        const d = Math.hypot(wx - x, wy - y);
        if (d >= bd) continue;
        // Сторона со стеной; из нескольких (угол, узкий проход) — та, к которой ближе место гибели.
        let side: (typeof SIDES)[number] | null = null;
        let sideScore = -Infinity;
        for (const s of SIDES) {
          const horizontal = s.dx !== 0;
          const solid = horizontal ? map.isSolid(ax + s.dx, ay) && map.isSolid(ax + s.dx, ay + 1) : map.isSolid(ax, ay + s.dy) && map.isSolid(ax + 1, ay + s.dy);
          if (!solid) continue;
          const score = (x - wx) * -s.nx + (y - wy) * -s.ny;
          if (score > sideScore) {
            sideScore = score;
            side = s;
          }
        }
        if (!side || !lineOfSight(map, x, y, wx, wy)) continue;
        bd = d;
        best = { x: wx - side.nx * S.lean, y: wy - side.ny * S.lean, nx: side.nx, ny: side.ny };
      }
    }
    return best ?? { x: nav.worldX(home), y: nav.worldY(home), nx: 0, ny: 1 };
  }

  private place(p: Pending): void {
    const M = MEMORIALS;
    const now = this.now;
    // Рядом уже есть — цветов добавляют туда же.
    const near = this.nearest(p.x, p.y, M.merge);
    if (near) {
      near.flowers = Math.min(M.cap.flowers, near.flowers + this.rng.int(1, 2));
      near.until = now + M.ttl;
      this.stats.merged++;
      return;
    }
    const spot = this.snap(p.x, p.y);
    if (!spot) return;
    const m: Memorial = {
      id: this.nextId++, x: spot.x, y: spot.y, name: p.name, pid: p.pid, since: now, until: now + M.ttl,
      flowers: this.rng.int(M.start.flowers[0], M.start.flowers[1]), candles: 0, nx: spot.nx, ny: spot.ny, visits: 0,
    };
    this.list.push(m);
    if (this.list.length > M.max) this.list.shift();
    this.stats.placed++;
    this.ctx.talk?.event(M.news.kind, m.x, m.y, { who: p.name, radius: M.news.radius });
  }

  // ───────────────────────────── запросы ─────────────────────────────

  /** Живое памятное место ближе r px к точке (ближайшее) или null. */
  nearest(x: number, y: number, r: number): Memorial | null {
    const now = this.now;
    let best: Memorial | null = null;
    let bd = r;
    for (const m of this.list) {
      if (m.until <= now) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /**
   * Памятное место того, кого c любил (родня, друг: Relations.lovesPid), не дальше visit.seek px; к одному месту —
   * не чаще visit.every с и не больше visit.max раз. Ближайшее; нет — null.
   */
  forVisitor(c: Character): Memorial | null {
    const rel = this.ctx.relations;
    if (!this.enabled || !c.alive || !rel?.enabled || !this.list.length) return null;
    const V = MEMORIALS.visit;
    const now = this.now;
    const seen = this.visited.get(c);
    let best: Memorial | null = null;
    let bd: number = V.seek;
    for (const m of this.list) {
      if (m.until <= now || m.pid === c.pid) continue;
      const d = Math.hypot(m.x - c.x, m.y - c.y);
      if (d >= bd) continue;
      const v = seen?.get(m.id);
      if (v && (v.n >= V.max || now - v.t < V.every)) continue;
      if (!rel.lovesPid(c, m.pid)) continue;
      bd = d;
      best = m;
    }
    return best;
  }

  /**
   * Где встать у места: якорь в 1–2 тайлах от него, не за стеной и не за спиной у снимка; у каждого посетителя своя
   * сторона (по номеру человека). null — подойти некуда.
   */
  spot(m: Memorial, c: Character): Vec2 | null {
    const { nav, map } = this.ctx;
    const ring = MEMORIALS.visit.ring;
    const home = nav.nearestWalkable(m.x, m.y, 2);
    if (home < 0) return null;
    const hx = nav.ax(home);
    const hy = nav.ay(home);
    // Предпочтительный угол: в сторону «наружу» ± до четверти круга, свой у каждого.
    const base = Math.atan2(m.ny, m.nx) + (hash01(c.pid, m.id, 0x5107) - 0.5) * Math.PI;
    let best: Vec2 | null = null;
    let bs = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const ax = hx + dx;
        const ay = hy + dy;
        if (!nav.isWalkable(ax, ay)) continue;
        const i = ay * nav.w + ax;
        const wx = nav.worldX(i);
        const wy = nav.worldY(i);
        const d = Math.hypot(wx - m.x, wy - m.y);
        if (d < ring[0] || d > ring[1] || (wx - m.x) * m.nx + (wy - m.y) * m.ny < -2 || !lineOfSight(map, wx, wy, m.x, m.y)) continue;
        let da = Math.abs(Math.atan2(wy - m.y, wx - m.x) - base);
        if (da > Math.PI) da = Math.PI * 2 - da;
        const score = da + d * 0.004;
        if (score < bs) {
          bs = score;
          best = { x: wx, y: wy };
        }
      }
    }
    return best;
  }

  // ───────────────────────────── приход ─────────────────────────────

  /**
   * c у памятного места: ночью — свеча, днём цветы (иногда и свеча), если место ещё не заставлено; срок продлён,
   * в душе — «поддержка», вслух — несколько слов.
   */
  visit(c: Character, m: Memorial): void {
    const { ctx } = this;
    const V = MEMORIALS.visit;
    const C = MEMORIALS.cap;
    const now = this.now;
    let candle = ctx.routine.night || this.rng.chance(V.candleDay);
    if (candle && m.candles >= C.candles) candle = false;
    else if (!candle && m.flowers >= C.flowers && m.candles < C.candles) candle = true;
    if (candle) {
      m.candles++;
      this.stats.candles++;
    } else if (m.flowers < C.flowers) {
      m.flowers++;
      this.stats.flowers++;
    }
    m.visits++;
    m.until = Math.min(now + MEMORIALS.ttl, m.until + V.extend);
    let seen = this.visited.get(c);
    if (!seen) this.visited.set(c, (seen = new Map()));
    const v = seen.get(m.id);
    if (v) {
      v.t = now;
      v.n++;
    } else seen.set(m.id, { t: now, n: 1 });
    if (ctx.relations?.enabled) ctx.relations.think(c, V.thought);
    if (this.rng.chance(V.sayChance)) c.say(fmt(phrase(this.rng, c, MEMORIALS.lines.visit), { name: m.name }), now, V.sayTime);
    this.stats.visits++;
  }

  update(): void {
    if (!this.enabled) return;
    const now = this.now;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (now < p.due) continue;
      // Тело ещё лежит — подождём (но не дольше bodyWait).
      if (now < p.due + MEMORIALS.bodyWait && this.ctx.combat.corpses.some((k) => k.pid === p.pid)) continue;
      this.pending.splice(i--, 1);
      this.place(p);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].until > now) continue;
      this.list.splice(i, 1);
      this.stats.expired++;
    }
  }
}
