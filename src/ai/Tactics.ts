import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Mover } from './Mover';
import type { Gunner } from './Gunner';
import type { Vec2 } from '../core/math';
import { castRay, castRayWith, lineOfSight } from '../world/visibility';
import { T } from '../world/tiles';
import { TACTICS, SUPPRESS, CROUCH, DOWNED } from '../config/tactics';
import { CHARACTER } from '../config/entities';
import { FACTIONS } from '../config/factions';
import { isMedic } from '../systems/CombatSystem';
import { faceTowards, turnTowards } from './facing';
import { pointSegmentDist2 } from '../core/math';

const near: Character[] = [];
const tmp: Vec2 = { x: 0, y: 0 };

/** Укрытие: где сидеть (hide) и откуда выглядывать (peek; у блока — то же место). */
export interface CoverSpot {
  hide: number;
  peek: number;
  kind: 'corner' | 'block';
}

/** Занятые укрытия (свои не встают в одно место) и кто кого спасает (один спасатель на раненого). */
const claims = new Map<Character, Vec2>();
const rescuers = new Map<Character, Character>();

function sameSide(a: Character, b: Character): boolean {
  return FACTIONS[a.faction].authority === FACTIONS[b.faction].authority;
}

/** Рядом с точкой уже стоит или идёт свой. */
function crowded(self: Character, ctx: AiContext, x: number, y: number): boolean {
  const r = TACTICS.spacing;
  for (const [c, p] of claims) {
    if (!c.alive) {
      claims.delete(c);
      continue;
    }
    if (c !== self && sameSide(c, self) && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r && Math.hypot(p.x - x, p.y - y) < r) return true;
  }
  for (const o of ctx.entities.near(x, y, r, near)) {
    if (o !== self && o.alive && !o.downed && sameSide(o, self) && Math.hypot(o.x - x, o.y - y) < r) return true;
  }
  return false;
}

/** Бетонный блок между точкой и угрозой не дальше CROUCH.coverReach от точки. */
export function blockToward(ctx: AiContext, x: number, y: number, tx: number, ty: number): boolean {
  const d = Math.hypot(tx - x, ty - y);
  if (d < 1) return false;
  let block = false;
  castRayWith(ctx.map, x, y, (tx - x) / d, (ty - y) / d, Math.min(d, CROUCH.coverReach), (bx, by) => {
    if (ctx.map.tileAt(bx, by) === T.BARRIER) block = true;
    return block || ctx.map.blocksShot(bx, by);
  });
  return block;
}

/** Порядок проб «выглянуть»: вбок от направления на врага, потом наискосок, потом прямо. */
const PEEK_ORDER = [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, 0];

/** Откуда выглянуть из-за угла (x, y): соседний якорь, с которого угроза видна и в дальности. */
function peekFrom(ctx: AiContext, x: number, y: number, threat: Vec2, reach: number): number {
  const nav = ctx.nav;
  const base = Math.atan2(threat.y - y, threat.x - x);
  const D = TACTICS.peekDist;
  for (const off of PEEK_ORDER) {
    const a = base + off;
    const pa = nav.nearestWalkable(x + Math.cos(a) * D, y + Math.sin(a) * D, 1);
    if (pa < 0) continue;
    const wx = nav.worldX(pa);
    const wy = nav.worldY(pa);
    const step = Math.hypot(wx - x, wy - y);
    if (step < 12 || step > D * 1.6) continue;
    if (!lineOfSight(ctx.map, x, y, wx, wy) || !lineOfSight(ctx.map, wx, wy, threat.x, threat.y)) continue;
    // Выглядывающий встаёт с допуском (не доходя до якоря) — угроза должна быть видна и чуть ближе к углу.
    const k = TACTICS.peekSlack / step;
    if (!lineOfSight(ctx.map, wx + (x - wx) * k, wy + (y - wy) * k, threat.x, threat.y)) continue;
    if (Math.hypot(threat.x - wx, threat.y - wy) > reach) continue;
    return pa;
  }
  return -1;
}

/**
 * Укрытие от угрозы рядом с собой (TACTICS.search px, sample проб): угол — врага не видно, но
 * в шаге можно выглянуть; или бетонный блок на линии огня (присесть). Не дальше leash от home,
 * не у своих, не ближе 60 px к врагу; лучше — ближе к себе и на удобной для ствола дистанции.
 */
export function findCover(
  self: Character,
  ctx: AiContext,
  threat: Vec2,
  home: Vec2 | null,
  leash: number,
  reach: number,
  zones: ReadonlySet<string> | null = null,
): CoverSpot | null {
  const nav = ctx.nav;
  const rng = ctx.rng;
  const ideal = Math.min(reach * 0.7, 280);
  const level = ctx.map.levelAt(self.x, self.y);
  const now = Math.hypot(threat.x - self.x, threat.y - self.y);
  let best: CoverSpot | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < TACTICS.sample; k++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = k === 0 ? 0 : rng.range(16, TACTICS.search);
    const a = nav.nearestWalkable(self.x + Math.cos(ang) * r, self.y + Math.sin(ang) * r, 2);
    if (a < 0) continue;
    const x = nav.worldX(a);
    const y = nav.worldY(a);
    if (home && Math.hypot(x - home.x, y - home.y) > leash) continue;
    if (ctx.map.levelAt(x, y) !== level) continue;
    if (zones && !zones.has(ctx.map.zoneAtWorld(x, y)?.kind ?? '')) continue;
    const dT = Math.hypot(threat.x - x, threat.y - y);
    // К врагу вплотную и мимо него не бежим.
    if (dT < 60 || dT < now - TACTICS.search * 0.6) continue;
    if (crowded(self, ctx, x, y)) continue;
    let score = -Math.hypot(x - self.x, y - self.y) / 25 - Math.abs(dT - ideal) / 90 + rng.range(0, 0.6);
    let spot: CoverSpot | null = null;
    if (lineOfSight(ctx.map, x, y, threat.x, threat.y)) {
      if (dT > reach || !blockToward(ctx, x, y, threat.x, threat.y)) continue;
      score += 6;
      spot = { hide: a, peek: a, kind: 'block' };
    } else {
      const peek = peekFrom(ctx, x, y, threat, reach);
      if (peek < 0) continue;
      score += 8;
      spot = { hide: a, peek, kind: 'corner' };
    }
    if (score > bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

/** Точка в 40–80 px от себя, которую не видно с угрозы (оттащить раненого). */
function safeSpot(self: Character, ctx: AiContext, threat: Vec2): Vec2 | null {
  const nav = ctx.nav;
  let best: Vec2 | null = null;
  let bestD = -1;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const r = 40 + (k % 3) * 20;
    const i = nav.nearestWalkable(self.x + Math.cos(a) * r, self.y + Math.sin(a) * r, 1);
    if (i < 0) continue;
    const x = nav.worldX(i);
    const y = nav.worldY(i);
    if (lineOfSight(ctx.map, threat.x, threat.y, x, y) || !lineOfSight(ctx.map, self.x, self.y, x, y)) continue;
    const d = Math.hypot(threat.x - x, threat.y - y);
    if (d > bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

// ————— Колонна штурмовой группы —————

interface Trail {
  xs: Float32Array;
  ys: Float32Array;
  n: number;
  head: number;
}
const trails = new WeakMap<Character, Trail>();

/** След ведущего: крошка, как только он ушёл от последней дальше TACTICS.stack.crumb. */
function trailOf(c: Character): Trail {
  const N = TACTICS.stack.crumbs;
  let t = trails.get(c);
  if (!t) {
    t = { xs: new Float32Array(N), ys: new Float32Array(N), n: 0, head: 0 };
    trails.set(c, t);
  }
  const last = (t.head - 1 + N) % N;
  if (t.n === 0 || Math.hypot(c.x - t.xs[last], c.y - t.ys[last]) >= TACTICS.stack.crumb) {
    t.xs[t.head] = c.x;
    t.ys[t.head] = c.y;
    t.head = (t.head + 1) % N;
    t.n = Math.min(N, t.n + 1);
  }
  return t;
}

/**
 * Место k-го в колонне: на k × gap назад по следу ведущего (след короче — дальше от ведущего
 * в сторону идущего, чтобы не толпиться у спины).
 */
export function columnSpot(leader: Character, k: number, self: Character, out: Vec2 = tmp): Vec2 {
  const N = TACTICS.stack.crumbs;
  const t = trailOf(leader);
  let need = k * TACTICS.stack.gap;
  let px = leader.x;
  let py = leader.y;
  for (let i = 0; i < t.n; i++) {
    const idx = (t.head - 1 - i + N * 2) % N;
    const x = t.xs[idx];
    const y = t.ys[idx];
    const seg = Math.hypot(x - px, y - py);
    if (seg >= need && seg > 0) {
      out.x = px + ((x - px) * need) / seg;
      out.y = py + ((y - py) * need) / seg;
      return out;
    }
    need -= seg;
    px = x;
    py = y;
  }
  const d = Math.hypot(self.x - px, self.y - py) || 1;
  const f = Math.min(1, need / d);
  out.x = px + (self.x - px) * f;
  out.y = py + (self.y - py) * f;
  return out;
}

/**
 * Идти k-м в колонне за ведущим: темп — как у него, отстал — догоняет (не быстрее maxSpeed). true —
 * ещё идёт.
 */
export function followColumn(self: Character, ctx: AiContext, mover: Mover, leader: Character, k: number, dt: number, st: { repath: number }, maxSpeed: number = CHARACTER.runSpeed * 0.9): boolean {
  const p = columnSpot(leader, k, self);
  const d = Math.hypot(p.x - self.x, p.y - self.y);
  st.repath -= dt;
  if (d < TACTICS.stack.near * 0.45) {
    mover.stop();
    return false;
  }
  const lead = Math.hypot(leader.vx, leader.vy);
  mover.speed = Math.max(45, Math.min(maxSpeed, lead * 1.05 + d * 0.9));
  if (st.repath <= 0 || mover.status === 'idle' || mover.status === 'arrived' || mover.status === 'failed') {
    st.repath = 0.45;
    const a = ctx.nav.nearestWalkable(p.x, p.y, 2);
    if (a >= 0) mover.goTo(self, ctx, a);
  }
  return true;
}

/** Колонна стоит: k-й смотрит в свой сектор (нечётные — влево от хода, чётные — вправо, замыкающий — назад). */
export function watchSector(self: Character, leader: Character, k: number, last: boolean, dt: number): void {
  const heading = Math.hypot(leader.gaitVx, leader.gaitVy) > 5 ? Math.atan2(leader.gaitVy, leader.gaitVx) : leader.facing;
  const off = last && k > 1 ? Math.PI : k % 2 ? -0.75 : 0.75;
  turnTowards(self, heading + off, dt, 5);
}

// ————— Бой из укрытия и помощь раненым —————

/**
 * Тактика бойца (один на мозг): бой из-за угла (сидит за стеной — выглядывает на очередь — назад;
 * прижали — сидит дольше, перезаряжается за стеной), из-за бетонного блока (присев; врага не видно
 * — огонь на подавление по месту, где его видели), помощь своим тяжелораненым (оттащить из-под огня,
 * перевязать и поднять), задержание лежащего врага (ВС).
 */
export class Tactician {
  mode: 'none' | 'move' | 'hide' | 'peek' | 'hold' = 'none';
  private spot: CoverSpot | null = null;
  private timer = 0;
  private rethink = 0;
  private recheck = 0;
  private fails = 0;
  private threat: Vec2 = { x: 0, y: 0 };
  private hasThreat = false;
  private suppressIn = 0;
  private suppressLeft = 0;
  private suppressAt: Vec2 | null = null;
  /** Помощь раненому: кого, пора ли искать снова, куда тащить и до какого времени. */
  private patient: Character | null = null;
  private rescueScan = 0;
  private repath = 0;
  private dragTo: Vec2 | null = null;
  private dragUntil = 0;
  private dragged = false;
  /** ВС: кого задерживает (лежащего врага). */
  private arrestee: Character | null = null;
  private arrestScan = 0;

  get label(): string {
    if (this.patient) return 'помощь раненому';
    if (this.arrestee) return 'задержание раненого';
    return { none: '', move: 'в укрытие', hide: 'за углом', peek: 'выглядывает', hold: 'за блоком' }[this.mode];
  }

  /** Сбросить бой из укрытия (цель пропала, мозг сменил занятие). */
  reset(self: Character): void {
    this.mode = 'none';
    this.spot = null;
    this.fails = 0;
    this.hasThreat = false;
    claims.delete(self);
  }

  /** Смотреть в сторону угрозы, если своей цели на виду нет. false — решает мозг. */
  face(self: Character, dt: number): boolean {
    if (this.mode === 'none' || !this.hasThreat) return false;
    faceTowards(self, this.threat.x, this.threat.y, dt);
    return true;
  }

  /** Угроза: цель (на виду — где стоит, пропала — где видели) или недавнее место контакта. */
  private threatOf(ctx: AiContext, gunner: Gunner): Vec2 | null {
    const t = gunner.target;
    const seen = gunner.lastSeenAt;
    const now = ctx.combat.now;
    if (t && t.alive && !t.downed) return now - seen.t < 0.5 ? t : seen;
    return now - seen.t < TACTICS.memory ? seen : null;
  }

  /** Место засвечено: из-за угла видно врага, у блока — блок больше не между нами. */
  private compromised(ctx: AiContext, threat: Vec2): boolean {
    const sp = this.spot;
    if (!sp) return true;
    const x = ctx.nav.worldX(sp.hide);
    const y = ctx.nav.worldY(sp.hide);
    if (sp.kind === 'corner') return lineOfSight(ctx.map, x, y, threat.x, threat.y) || !lineOfSight(ctx.map, ctx.nav.worldX(sp.peek), ctx.nav.worldY(sp.peek), threat.x, threat.y);
    return lineOfSight(ctx.map, x, y, threat.x, threat.y) && !blockToward(ctx, x, y, threat.x, threat.y);
  }

  /**
   * Бой из укрытия. home/leash — не отходить от своей точки (пост, цель похода); zones — укрытия
   * только в этих зонах (у КПП — не уходить на тропу). Возвращает true, если движение задано здесь
   * (мозгу mover не трогать); false — укрытия нет, пусть стоит и стреляет.
   */
  fight(
    self: Character,
    ctx: AiContext,
    gunner: Gunner,
    mover: Mover,
    dt: number,
    home: Vec2 | null = null,
    leash: number = TACTICS.leash,
    zones: ReadonlySet<string> | null = null,
  ): boolean {
    if (!TACTICS.factions.includes(self.faction)) return false;
    const combat = ctx.combat;
    const threat = this.threatOf(ctx, gunner);
    if (!threat) {
      if (this.mode !== 'none') this.reset(self);
      return false;
    }
    this.threat.x = threat.x;
    this.threat.y = threat.y;
    this.hasThreat = true;
    gunner.memory = TACTICS.memory;
    this.rethink -= dt;
    this.recheck -= dt;
    const nav = ctx.nav;
    const reach = combat.reach(self) || 200;
    let need = !this.spot && this.rethink <= 0;
    if (this.spot && this.recheck <= 0) {
      this.recheck = TACTICS.exposedRecheck;
      if (this.rethink <= 0 && this.compromised(ctx, threat)) need = true;
    }
    if (need) {
      this.rethink = TACTICS.rethink;
      const spot = findCover(self, ctx, threat, home, leash, reach, zones);
      if (!spot) {
        this.spot = null;
        this.mode = 'none';
        claims.delete(self);
        return false;
      }
      this.spot = spot;
      this.mode = 'move';
      this.fails = 0;
      claims.set(self, { x: nav.worldX(spot.hide), y: nav.worldY(spot.hide) });
      mover.goTo(self, ctx, spot.hide);
      if (self.suppress >= SUPPRESS.pinned && (!self.speech || self.speech.until < combat.now)) self.say(ctx.rng.pick(SUPPRESS.lines), combat.now, 1.4);
    }
    const sp = this.spot;
    if (!sp) return false;
    const hx = nav.worldX(sp.hide);
    const hy = nav.worldY(sp.hide);
    const w = combat.weaponOf(self);
    const pinned = self.suppress >= SUPPRESS.pinned;
    switch (this.mode) {
      case 'move': {
        mover.speed = CHARACTER.runSpeed * 0.85;
        if (Math.hypot(hx - self.x, hy - self.y) < 12) {
          mover.stop();
          this.mode = sp.kind === 'block' ? 'hold' : 'hide';
          this.timer = ctx.rng.range(TACTICS.hide[0], TACTICS.hide[1]);
        } else if (mover.status === 'failed' || mover.status === 'idle' || mover.status === 'arrived') {
          if (++this.fails > 3) {
            this.spot = null;
            this.mode = 'none';
            claims.delete(self);
            return false;
          }
          mover.goTo(self, ctx, sp.hide);
        }
        break;
      }
      case 'hide': {
        // За углом: перезарядиться, отдышаться; прижат — сидит дольше.
        mover.stop();
        if (w?.ammo && self.mag < w.magazine * 0.7) combat.reload(self);
        this.timer -= dt * (pinned ? 0.25 : 1);
        if (this.timer <= 0 && !combat.reloading(self) && (self.mag > 0 || !w?.ammo)) {
          this.mode = 'peek';
          this.timer = ctx.rng.range(TACTICS.peek[0], TACTICS.peek[1]);
          mover.speed = CHARACTER.walkSpeed * 1.1;
          mover.goTo(self, ctx, sp.peek);
        }
        break;
      }
      case 'peek': {
        const px = nav.worldX(sp.peek);
        const py = nav.worldY(sp.peek);
        const at = Math.hypot(px - self.x, py - self.y) < 10;
        if (at) {
          mover.stop();
          this.timer -= dt;
        } else if (mover.status !== 'moving' && mover.status !== 'pending') mover.goTo(self, ctx, sp.peek);
        // Очередь дана, магазин пуст или прижали — назад за угол.
        if (this.timer <= 0 || (w?.ammo && self.mag <= 0) || self.suppress >= SUPPRESS.pinned + 0.15) {
          this.mode = 'move';
          mover.speed = CHARACTER.runSpeed * 0.85;
          mover.goTo(self, ctx, sp.hide);
        }
        break;
      }
      case 'hold': {
        mover.stop();
        if (Math.hypot(hx - self.x, hy - self.y) > 20) {
          this.mode = 'move';
          mover.goTo(self, ctx, sp.hide);
          break;
        }
        this.suppressive(self, ctx, gunner, dt, threat);
        break;
      }
      default:
        break;
    }
    return true;
  }

  /**
   * Огонь на подавление: врага не видно, но недавно видели — короткие очереди по тому месту
   * (пули ложатся рядом и прижимают), если стена не у самого ствола и своих на линии нет.
   */
  suppressive(self: Character, ctx: AiContext, gunner: Gunner, dt: number, at: Vec2 | null = null): void {
    const combat = ctx.combat;
    const seen = gunner.lastSeenAt;
    const w = combat.weaponOf(self);
    if (!w || w.mode === 'melee' || w.blastMul || gunner.holdFire) return;
    if (self.aiming && gunner.target) return;
    this.suppressIn -= dt;
    if (this.suppressLeft > 0 && this.suppressAt) {
      if (combat.canFire(self)) {
        combat.fire(self, this.suppressAt.x + ctx.rng.range(-14, 14), this.suppressAt.y + ctx.rng.range(-14, 14));
        this.suppressLeft--;
      }
      return;
    }
    if (this.suppressIn > 0) return;
    this.suppressIn = ctx.rng.range(TACTICS.suppressEvery[0], TACTICS.suppressEvery[1]);
    const p = at ?? (combat.now - seen.t < 5 ? seen : null);
    if (!p || self.mag < Math.max(2, w.magazine / 3)) return;
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    if (d < 40 || d > Math.min(w.range, w.effectiveRange * 2)) return;
    // Стена у самого ствола — стрелять некуда.
    if (castRay(ctx.map, self.x, self.y, (p.x - self.x) / d, (p.y - self.y) / d, d) < d * 0.6) return;
    for (const o of ctx.entities.near((self.x + p.x) / 2, (self.y + p.y) / 2, d / 2 + 16, near)) {
      if (o !== self && o.alive && !o.downed && sameSide(o, self) && pointSegmentDist2(o.x, o.y, self.x, self.y, p.x, p.y) < 18 * 18) return;
    }
    this.suppressAt = { x: p.x, y: p.y };
    this.suppressLeft = ctx.rng.int(TACTICS.suppressBurst[0], TACTICS.suppressBurst[1]) * (w.mode === 'auto' ? 1 : 0.5) | 0 || 1;
    self.aiming = true;
    faceTowards(self, p.x, p.y, 1);
  }

  /** Лежащий раненый p — на виду у врага (угроза: цель или недавнее место контакта). */
  private dangerTo(p: Character, ctx: AiContext, gunner: Gunner): Vec2 | null {
    const t = gunner.target;
    if (t && t.alive && !t.downed && lineOfSight(ctx.map, t.x, t.y, p.x, p.y)) return t;
    const seen = gunner.lastSeenAt;
    if (ctx.combat.now - seen.t < 3 && lineOfSight(ctx.map, seen.x, seen.y, p.x, p.y)) return seen;
    return null;
  }

  private dropPatient(self: Character): void {
    const p = this.patient;
    if (p && rescuers.get(p) === self) rescuers.delete(p);
    this.patient = null;
    this.dragTo = null;
    this.dragged = false;
  }

  /** Найти своего тяжелораненого рядом, которого ещё никто не спасает (нужен бинт или аптечка). */
  private pickPatient(self: Character, ctx: AiContext, gunner: Gunner): void {
    const combat = ctx.combat;
    if (this.patient) return;
    if (!combat.hasDressing(self)) return;
    const medic = isMedic(self);
    // В перестрелке (цель на виду) — только медик или раненый совсем рядом.
    const hot = !!gunner.target && self.aiming;
    const level = ctx.map.levelAt(self.x, self.y);
    let best: Character | null = null;
    let bestD: number = DOWNED.helpRange;
    for (const o of ctx.entities.near(self.x, self.y, bestD, near)) {
      if (o === self || !o.alive || !o.downed || combat.isHostile(self, o) || !sameSide(self, o)) continue;
      if (o.faction !== self.faction && !medic && !FACTIONS[self.faction].authority) continue;
      const r = rescuers.get(o);
      if (r && r !== self && r.alive && !r.downed) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d >= bestD || (hot && !medic && d > 90) || ctx.map.levelAt(o.x, o.y) !== level) continue;
      bestD = d;
      best = o;
    }
    if (!best) return;
    this.patient = best;
    this.dragged = false;
    rescuers.set(best, self);
  }

  /**
   * Помощь своему тяжелораненому: подбежать; лежит на виду у врага — оттащить за укрытие; потом
   * поднять (DOWNED.reviveTime). true — занят этим (движение задано).
   */
  rescue(self: Character, ctx: AiContext, gunner: Gunner, mover: Mover, dt: number): boolean {
    const combat = ctx.combat;
    if (self.reviveUntil > 0 && self.reviving) {
      mover.stop();
      faceTowards(self, self.reviving.x, self.reviving.y, dt);
      return true;
    }
    this.rescueScan -= dt;
    this.repath -= dt;
    if (this.rescueScan <= 0) {
      this.rescueScan = DOWNED.scanEvery;
      this.pickPatient(self, ctx, gunner);
    }
    const p = this.patient;
    if (!p) return false;
    if (!p.alive || !p.downed || rescuers.get(p) !== self || !combat.hasDressing(self)) {
      if (self.dragging) combat.stopDrag(self);
      this.dropPatient(self);
      return false;
    }
    // Тащит за укрытие.
    if (self.dragging === p) {
      const to = this.dragTo;
      if (!to || Math.hypot(to.x - self.x, to.y - self.y) < 14 || combat.now > this.dragUntil) {
        combat.stopDrag(self);
        this.dragTo = null;
      } else {
        if (mover.status !== 'moving' && mover.status !== 'pending') {
          const a = ctx.nav.nearestWalkable(to.x, to.y, 2);
          if (a >= 0) mover.goTo(self, ctx, a);
        }
        return true;
      }
    }
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    if (d > DOWNED.reach + self.radius - 4) {
      mover.speed = CHARACTER.runSpeed * 0.85;
      if (this.repath <= 0 || mover.status === 'idle' || mover.status === 'arrived' || mover.status === 'failed') {
        this.repath = 0.6;
        const a = ctx.nav.nearestWalkable(p.x, p.y, 2);
        if (a >= 0) mover.goTo(self, ctx, a);
      }
      return true;
    }
    mover.stop();
    // Лежит на виду у врага — сперва за укрытие.
    const threat = !this.dragged ? this.dangerTo(p, ctx, gunner) : null;
    if (threat) {
      this.dragged = true;
      const to = safeSpot(self, ctx, threat);
      if (to && combat.startDrag(self, p)) {
        this.dragTo = to;
        this.dragUntil = combat.now + 5;
        mover.speed = CHARACTER.walkSpeed;
        const a = ctx.nav.nearestWalkable(to.x, to.y, 2);
        if (a >= 0) mover.goTo(self, ctx, a);
        self.say('Тащу в укрытие! Прикройте!', combat.now, 1.8);
        return true;
      }
    }
    if (combat.startRevive(self, p)) return true;
    this.dropPatient(self);
    return false;
  }

  /**
   * ВС в городе: лежащего раненого врага (повстанец, напавший) — стабилизировать и задержать.
   * Возвращает задержанного, когда наручники надеты (мозг ведёт его в КПЗ); занят — через busy.
   */
  detain(self: Character, ctx: AiContext, mover: Mover, dt: number): { busy: boolean; cuffed: Character | null } {
    const combat = ctx.combat;
    const out = { busy: false, cuffed: null as Character | null };
    const a = this.arrestee;
    if (a && a.alive && a.law.phase === 'cuffed' && a.law.handler === self) {
      this.arrestee = null;
      out.cuffed = a;
      return out;
    }
    if (self.reviveUntil > 0 && self.reviveArrest) {
      mover.stop();
      out.busy = true;
      return out;
    }
    this.arrestScan -= dt;
    if (!a || !a.alive || !a.downed) {
      this.arrestee = null;
      if (this.arrestScan > 0) return out;
      this.arrestScan = DOWNED.scanEvery;
      let bestD = DOWNED.helpRange * 0.8;
      for (const o of ctx.entities.near(self.x, self.y, bestD, near)) {
        if (!o.alive || !o.downed || FACTIONS[o.faction].authority || !(o.faction === 'rebel' || o.hostile)) continue;
        if (combat.reviverOf(o) || rescuers.has(o)) continue;
        const zone = ctx.map.zoneAtWorld(o.x, o.y)?.kind;
        if (zone === 'checkpoint' || zone === 'outlands' || zone === 'wasteland') continue;
        const d = Math.hypot(o.x - self.x, o.y - self.y);
        if (d < bestD && lineOfSight(ctx.map, self.x, self.y, o.x, o.y)) {
          bestD = d;
          this.arrestee = o;
        }
      }
      if (!this.arrestee) return out;
    }
    const t = this.arrestee!;
    out.busy = true;
    const d = Math.hypot(t.x - self.x, t.y - self.y);
    if (d > DOWNED.reach + self.radius - 4) {
      this.repath -= dt;
      mover.speed = CHARACTER.walkSpeed * 1.3;
      if (this.repath <= 0 || mover.status === 'idle' || mover.status === 'arrived' || mover.status === 'failed') {
        this.repath = 0.6;
        const i = ctx.nav.nearestWalkable(t.x, t.y, 2);
        if (i >= 0) mover.goTo(self, ctx, i);
      }
      return out;
    }
    mover.stop();
    if (!combat.startRevive(self, t, true)) this.arrestee = null;
    return out;
  }
}

