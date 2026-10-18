import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { MeleeAttack } from '../entities/meleeState';
import type { GameMap } from '../world/GameMap';
import type { Rng } from '../core/rng';
import type { EventBus } from '../core/EventBus';
import type { CombatSystem } from './CombatSystem';
import { lineOfSight } from '../world/visibility';
import { MELEE, MELEE_LOOK, type MeleeStyle, type StrikeDef } from '../config/melee';
import { FISTS } from '../config/brawl';
import { COMBAT } from '../config/combat';
import { WEAPONS, type WeaponClass } from '../config/items';
import { FACTIONS } from '../config/factions';
import { armorOf, behind } from './wounds';

const DEG = Math.PI / 180;
const near: Character[] = [];

/** След удара (только отрисовка): рисуется у бьющего — серп по дуге или клин по выпаду. */
export interface Swing {
  by: Character;
  /** Направление удара, полуугол дуги (рад), дальность от центра бьющего и где след обрывается (попал — у цели), px. */
  ang: number;
  half: number;
  reach: number;
  stop: number;
  motion: StrikeDef['motion'];
  side: 1 | -1;
  style: MeleeStyle;
  heavy: boolean;
  hit: boolean;
  /** Осталось и всего, с. */
  t: number;
  life: number;
}

/** Базовые числа стиля: урон, дальность (зазор между кругами), замедление, бронебойность, × в спину. */
interface Base {
  damage: number;
  range: number;
  stun: number;
  pierce: number;
  backstab: number;
}

function diff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Класс оружия для эффектов (кулаки — null). */
function classOf(style: MeleeStyle): WeaponClass | null {
  return style === 'fists' ? null : style === 'blade' ? 'blade' : 'melee';
}

/**
 * Ближний бой (config/melee.ts): удар — замах → удар → отход, серии по стилю (кулаки, дубинка, нож),
 * тяжёлый удар серии отбрасывает и пробивает блок; блок и парирование; попавший удар сбивает замах
 * цели, отбрасывает её и оглушает; кулаком не убить — нокаут (лежит). Урон по зонам (голова, корпус,
 * руки) с бронёй; нож в спину — в полную силу и мимо брони, режет (кровотечение).
 * Пишет эффекты боя (Fx: swing, stab, block, parry, ko) и следы ударов (swings) — для картинки и звука.
 */
export class Melee {
  readonly swings: Swing[] = [];
  /** Удары в замахе (ждут момента удара) и нажатые заранее. */
  private readonly pending: Character[] = [];
  private readonly queue: Character[] = [];
  readonly stats = { attacks: 0, hits: 0, whiffs: 0, blocks: 0, parries: 0, breaks: 0, interrupts: 0, kos: 0 };

  constructor(
    private readonly combat: CombatSystem,
    private readonly entities: EntityManager,
    private readonly map: GameMap,
    private readonly rng: Rng,
    private readonly bus: EventBus,
  ) {}

  private get now(): number {
    return this.combat.now;
  }

  /** Чем бьёт и закрывается: пустые руки — кулаки, дубинка, нож; огнестрел — ничем (null). */
  styleOf(c: Character): MeleeStyle | null {
    if (!c.weapon) return 'fists';
    const w = WEAPONS[c.weapon];
    return w.class === 'blade' ? 'blade' : w.mode === 'melee' ? 'baton' : null;
  }

  private base(c: Character, style: MeleeStyle): Base {
    if (style === 'fists' || !c.weapon) return { damage: FISTS.damage, range: FISTS.range, stun: FISTS.stun, pierce: 0, backstab: 1 };
    const w = WEAPONS[c.weapon];
    return { damage: w.damage, range: w.range, stun: w.stun, pierce: w.pierce, backstab: w.backstab ?? 1 };
  }

  /** Следующий удар серии (серия кончилась — первый). */
  nextStrike(c: Character, style: MeleeStyle): StrikeDef {
    const chain = MELEE.styles[style];
    return chain[this.now <= c.melee.comboUntil ? c.melee.combo % chain.length : 0];
  }

  /** Дальность следующего удара — от центра бьющего, px (ИИ, подсказка игроку). */
  reachOf(c: Character, style: MeleeStyle | null = this.styleOf(c)): number {
    if (!style) return 0;
    return c.radius + this.base(c, style).range * this.nextStrike(c, style).reach;
  }

  /** Замахивается (удар ещё не нанесён). */
  winding(c: Character): boolean {
    const a = c.melee.attack;
    return !!a && !a.done;
  }

  /** Бьёт: замах или отход. */
  attacking(c: Character): boolean {
    const a = c.melee.attack;
    return !!a && this.now < a.end && !a.broken;
  }

  /** Можно начать удар: на ногах, не сбит, не вырубили, руки свободны, прошлый удар отработан. */
  ready(c: Character): boolean {
    const m = c.melee;
    const now = this.now;
    return c.alive && now >= c.nextShot && m.ko <= now && m.stagger <= now && !this.combat.busy(c) && !(m.attack && !m.attack.done);
  }

  /**
   * Начать удар в сторону (tx, ty): замах, урон — в момент удара (update). style — кулаки (punch) или
   * по тому, что в руках. Возвращает, кого удар достанет сейчас (урона ещё нет); null — не вышло или некого.
   * Рано (идёт отход) — удар встаёт в очередь и выходит сам, как только можно (серия без провалов).
   */
  start(c: Character, tx: number, ty: number, style: MeleeStyle | null = this.styleOf(c)): Character | null {
    if (!style) return null;
    const now = this.now;
    const m = c.melee;
    if (!this.ready(c)) {
      if (c.alive && m.attack?.done && c.nextShot - now <= MELEE.buffer && m.stagger <= now && m.ko <= now) {
        if (m.queued <= now) this.queue.push(c);
        m.queued = now + MELEE.buffer;
      }
      return null;
    }
    const chain = MELEE.styles[style];
    const step = now <= m.comboUntil ? m.combo % chain.length : 0;
    const strike = chain[step];
    c.facing = Math.atan2(ty - c.y, tx - c.x);
    m.block = false;
    m.queued = 0;
    const at = now + strike.windup;
    const end = at + strike.recover;
    // На кого замахнулся: из тех, кого удар достаёт, — ближе всех к точке, куда бьёт.
    const aim = this.target(c, style, strike, tx, ty);
    m.attack = { style, weapon: c.weapon, strike, step, aim, start: now, at, end, done: false, hit: false, broken: false };
    c.nextShot = end;
    m.combo = strike.heavy ? 0 : step + 1;
    m.comboUntil = end + MELEE.combo.window;
    m.stance = Math.max(m.stance, end + MELEE.stance);
    this.pending.push(c);
    this.stats.attacks++;
    return aim;
  }

  /**
   * Поднять или опустить блок (игрок — ПКМ, NPC в драке). Не закрыться: в замахе и отходе, сбитому,
   * вырубленному, с пробитым блоком, с огнестрелом в руках. Возвращает, поднят ли блок.
   */
  guard(c: Character, on: boolean): boolean {
    const m = c.melee;
    const now = this.now;
    const can =
      on && c.alive && this.styleOf(c) !== null && m.ko <= now && m.guardBreak <= now && (m.block || m.stagger <= now) &&
      !(m.attack && now < m.attack.end && !m.attack.broken) && !this.combat.busy(c);
    if (can && !m.block) m.blockSince = now;
    m.block = can;
    if (can) m.stance = Math.max(m.stance, now + MELEE.stance);
    return can;
  }

  /** Вырубили кулаками: лежит до. */
  knockedOut(c: Character): boolean {
    return c.melee.ko > this.now;
  }

  /** Шаг боя: нажатые заранее удары, удары в момент удара, следы. */
  update(dt: number): void {
    const now = this.now;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const c = this.queue[i];
      const m = c.melee;
      if (m.queued < now || !c.alive) {
        m.queued = 0;
        this.queue.splice(i, 1);
      } else if (this.ready(c)) {
        this.queue.splice(i, 1);
        this.start(c, c.x + Math.cos(c.facing) * 40, c.y + Math.sin(c.facing) * 40);
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      const a = c.melee.attack;
      if (!a || a.done) {
        this.pending.splice(i, 1);
        continue;
      }
      // Сбили замах, упал, вырубили, занял руки, сменил оружие — удар сорван.
      if (!c.alive || c.downed || c.melee.ko > now || c.melee.stagger > a.start || c.weapon !== a.weapon || this.combat.busy(c)) {
        this.pending.splice(i, 1);
        a.done = a.broken = true;
        c.melee.combo = 0;
        c.nextShot = Math.min(c.nextShot, now);
        if (c.alive && !c.downed) this.stats.interrupts++;
        continue;
      }
      if (now < a.at) continue;
      this.pending.splice(i, 1);
      this.strike(c, a);
    }
    for (let i = this.swings.length - 1; i >= 0; i--) if ((this.swings[i].t -= dt) <= 0) this.swings.splice(i, 1);
  }

  /** Убрать всё (новый раунд, город). */
  clear(): void {
    this.swings.length = 0;
    this.pending.length = 0;
    this.queue.length = 0;
  }

  /** Момент удара: выпад вперёд, кого достал — урон, след и эффект. */
  private strike(c: Character, a: MeleeAttack): void {
    const s = a.strike;
    a.done = true;
    const ang = c.facing;
    this.push(c, ang, s.lunge / Math.sqrt(c.mass));
    // Бьёт того, на кого замахнулся. Тот ушёл (или замах в пустоту): NPC — мимо, прохожих не задевает;
    // игрок — по тому, кто подвернулся.
    const t = a.aim && this.reaches(c, a.aim, a.style, s) ? a.aim : c.isPlayer ? this.target(c, a.style, s) : null;
    const reach = c.radius + this.base(c, a.style).range * s.reach;
    const L = MELEE_LOOK.trail;
    // Выпад попал — след обрывается у тела цели, а не за её спиной.
    const stop = t ? Math.max(c.radius, Math.min(reach, Math.hypot(t.x - c.x, t.y - c.y) - t.radius * 0.4)) : reach;
    this.swings.push({ by: c, ang, half: s.arc * DEG, reach, stop, motion: s.motion, side: s.side, style: a.style, heavy: !!s.heavy, hit: !!t, t: L.sweep + L.fade, life: L.sweep + L.fade });
    const fx = this.combat.emit('swing', c.x + Math.cos(ang) * reach * 0.7, c.y + Math.sin(ang) * reach * 0.7, ang, classOf(a.style), c, t, null, s.heavy ? 1 : 0);
    fx.style = a.style;
    fx.heavy = !!s.heavy;
    if (!t) {
      this.stats.whiffs++;
      return;
    }
    a.hit = true;
    this.hit(c, t, a);
  }

  /**
   * Кого достаёт удар: ближайший в секторе перед собой; с точкой (tx, ty) — ближе всех к ней (в кого
   * целились). null — некого.
   */
  private target(c: Character, style: MeleeStyle, s: StrikeDef, tx?: number, ty?: number): Character | null {
    const reach = this.base(c, style).range * s.reach;
    let best: Character | null = null;
    let bestScore = Infinity;
    for (const o of this.entities.near(c.x, c.y, c.radius + reach + 16, near)) {
      if (o === c || !this.reaches(c, o, style, s)) continue;
      const gap = Math.hypot(o.x - c.x, o.y - c.y) - o.radius - c.radius;
      const da = Math.abs(diff(Math.atan2(o.y - c.y, o.x - c.x), c.facing));
      const score = (tx === undefined || ty === undefined ? gap + da * 8 : Math.hypot(o.x - tx, o.y - ty) + gap * 0.5) + (o.downed ? 30 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  /** Достаёт ли удар o: на дальности, в секторе (вплотную — и сбоку, но не за спиной), без стены между. */
  private reaches(c: Character, o: Character, style: MeleeStyle, s: StrikeDef): boolean {
    // Лежачего (ранен, нокаут) кулаком не бьют; оружием — добивают.
    if (!o.alive || (style === 'fists' && (o.downed || o.melee.ko > this.now))) return false;
    const reach = this.base(c, style).range * s.reach;
    const gap = Math.hypot(o.x - c.x, o.y - c.y) - o.radius - c.radius;
    if (gap > reach) return false;
    const half = s.arc * DEG;
    const da = Math.abs(diff(Math.atan2(o.y - c.y, o.x - c.x), c.facing));
    if (da > (gap <= 4 ? Math.max(half, 100 * DEG) : half)) return false;
    return lineOfSight(this.map, c.x, c.y, o.x, o.y);
  }

  /** Чем t сейчас закрывается (блок поднят, не пробит, не сбит и не вырубили) или null. */
  private guardOf(t: Character): MeleeStyle | null {
    const m = t.melee;
    const now = this.now;
    if (!m.block || m.guardBreak > now || m.ko > now || this.combat.busy(t)) return null;
    return this.styleOf(t);
  }

  private hit(c: Character, t: Character, a: MeleeAttack): void {
    const now = this.now;
    const s = a.strike;
    const style = a.style;
    const B = MELEE.block;
    const b = this.base(c, style);
    const dir = Math.atan2(t.y - c.y, t.x - c.x);
    const hx = t.x - Math.cos(dir) * t.radius;
    const hy = t.y - Math.sin(dir) * t.radius;
    const tm = t.melee;
    const back = behind(t, c);
    const guard = back ? null : this.guardOf(t);
    let take = 1;
    let blocked = false;
    if (guard && Math.abs(diff(dir + Math.PI, t.facing)) <= B.arc * DEG) {
      if (!s.heavy && now - tm.blockSince <= B.parry) return this.parry(c, t, dir, hx, hy, style, guard);
      blocked = true;
      this.stats.blocks++;
      if (s.heavy) {
        // Тяжёлый пробивает блок: руки разбиты в стороны, закрыться не выйдет ещё guardBreak с.
        tm.block = false;
        tm.guardBreak = now + B.guardBreak;
        take = B.heavyTake;
        this.stats.breaks++;
      } else take = B.take[guard][style];
    }
    // Зона: в спину — корпус; голыми руками от ножа — порез по рукам.
    let zone: 'head' | 'torso' | 'arm' = back ? 'torso' : this.rng.chance(s.head) ? 'head' : 'torso';
    if (blocked && style === 'blade' && guard === 'fists') zone = 'arm';
    const armor = armorOf(t);
    const plate = zone === 'head' ? armor.head : zone === 'torso' ? armor.torso : 0;
    let mul = s.damage * MELEE.zones[zone];
    let reduce: number;
    if (style === 'blade') {
      // Нож в спину — всегда удар в полную силу и мимо брони.
      if (back) mul = Math.max(1, s.damage) * b.backstab;
      reduce = back ? 1 : 1 - plate * (1 - b.pierce);
    } else {
      if (back) mul *= MELEE.backMul;
      reduce = 1 - plate * 0.5;
    }
    let dmg = b.damage * mul * reduce * take;
    // Кулаком не убить: здоровье не ниже порога (дальше — нокаут).
    if (style === 'fists') dmg = Math.min(dmg, Math.max(0, t.health - FISTS.floor));
    // Сбит (в блоке — нет, пока блок не пробит), оглушён, отброшен.
    const hard = !blocked || s.heavy;
    if (hard) tm.stagger = Math.max(tm.stagger, now + s.stagger * (back ? MELEE.backMul : 1));
    t.stunUntil = Math.max(t.stunUntil, now + b.stun * s.stun * (hard ? 1 : 0.25));
    t.aim = 0;
    this.push(t, dir, (s.knock * (blocked ? B.knockMul : 1)) / Math.sqrt(t.mass));
    tm.struckAt = now;
    tm.struckAng = dir;
    tm.struckPow = blocked ? 0.25 : Math.min(1, dmg / 30 + (s.heavy ? 0.35 : 0.1));
    tm.stance = Math.max(tm.stance, now + MELEE.stance);
    this.stats.hits++;
    this.combat.stats.hit++;
    if (style !== 'fists') this.combat.hits++;
    // Брызги — по ходу клинка: у дуги — вдоль взмаха, у выпада — насквозь.
    const fxAng = s.motion === 'slash' ? dir + s.side * Math.PI * 0.35 : dir;
    const fx = this.combat.emit(blocked ? 'block' : 'stab', hx, hy, fxAng, classOf(style), c, t, zone, dmg, back);
    fx.style = style;
    fx.heavy = !!s.heavy;
    if (blocked) fx.guard = guard ?? undefined;
    if (dmg > 0 && style === 'blade') {
      this.combat.addDecal(hx + Math.cos(dir) * 6, hy + Math.sin(dir) * 6, 'blood', COMBAT.decals.bloodTime, this.rng.range(0, Math.PI), this.rng.range(0.7, 1.1));
      this.combat.wound(t, dmg, zone);
    } else if (dmg > 4 && !blocked && (zone === 'head' || s.heavy) && this.rng.chance(0.3)) {
      // Разбитый нос — пара капель на земле.
      this.combat.addDecal(hx + Math.cos(dir) * 8, hy + Math.sin(dir) * 8, 'blood', COMBAT.decals.bloodTime * 0.5, this.rng.range(0, Math.PI), this.rng.range(0.35, 0.55));
    }
    if (back && style === 'blade' && c.isPlayer) this.bus.emit('log', { text: `Удар в спину: ${t.name}.`, kind: 'world' });
    if (dmg > 0) this.combat.damage(t, dmg, c, zone);
    else if (!c.disguised && !FACTIONS[c.faction].authority && FACTIONS[t.faction].authority) this.combat.damage(t, 0, c, zone);
    if (style === 'fists' && t.alive && !t.downed && t.health <= FISTS.floor + 0.01 && tm.ko <= now) this.knockout(t, c, dir);
    if (style === 'fists') this.combat.onPunch(t, c);
  }

  /** Парирование: урона нет, бьющий сбит и отброшен, его серия сначала. */
  private parry(c: Character, t: Character, dir: number, hx: number, hy: number, style: MeleeStyle, guard: MeleeStyle): void {
    const now = this.now;
    const B = MELEE.block;
    const m = c.melee;
    m.stagger = Math.max(m.stagger, now + B.parryStagger);
    m.combo = 0;
    m.struckAt = now;
    m.struckAng = dir + Math.PI;
    m.struckPow = 0.45;
    this.push(c, dir + Math.PI, B.parryKnock / Math.sqrt(c.mass));
    t.melee.stance = Math.max(t.melee.stance, now + MELEE.stance);
    this.stats.parries++;
    this.stats.blocks++;
    const fx = this.combat.emit('parry', hx, hy, dir + Math.PI, classOf(guard), t, c, null, 0);
    fx.style = style;
    fx.guard = guard;
    // Ударить ВС — нападение, даже если он закрылся.
    if (!c.disguised && !FACTIONS[c.faction].authority && FACTIONS[t.faction].authority) this.combat.damage(t, 0, c, null);
    if (style === 'fists') this.combat.onPunch(t, c);
  }

  /** Нокаут кулаком: лежит FISTS.knockout с (оглушён, не бьёт и не закрывается). */
  private knockout(t: Character, by: Character, dir: number): void {
    const now = this.now;
    const m = t.melee;
    m.ko = now + FISTS.knockout;
    m.block = false;
    if (m.attack && !m.attack.done) m.attack.done = m.attack.broken = true;
    t.stunUntil = Math.max(t.stunUntil, m.ko);
    t.wantX = t.wantY = 0;
    this.stats.kos++;
    const fx = this.combat.emit('ko', t.x, t.y, dir, null, by, t, 'head', 0);
    fx.style = 'fists';
  }

  /** Толчок: выпад или отброс (px/с, гасит разгон физики); скорость от толчка — не бег. */
  private push(c: Character, ang: number, v: number): void {
    if (v <= 0 || c.downed) return;
    c.vx += Math.cos(ang) * v;
    c.vy += Math.sin(ang) * v;
    c.melee.impulse = this.now + MELEE.impulse;
  }
}

