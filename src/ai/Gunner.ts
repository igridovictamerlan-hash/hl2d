import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Rng } from '../core/rng';
import { canSeeCircle } from '../world/visibility';
import { faceTowards } from './facing';
import { COMBAT } from '../config/combat';
import { VISION } from '../config/vision';
import { WEAPONS } from '../config/items';
import { pointSegmentDist2 } from '../core/math';
import { FACTIONS } from '../config/factions';
import { angleDiff } from '../systems/CombatSystem';

const near: Character[] = [];
const DEG = Math.PI / 180;

/** Свой-чужой по стороне (Альянс / остальные): выстрел «своего» подсказывает, куда смотреть. */
function differentSides(a: Character, b: Character): boolean {
  return FACTIONS[a.faction].authority !== FACTIONS[b.faction].authority;
}

/**
 * Стрелок для ИИ: выбирает ближайшего врага в угле обзора (глаз на спине нет) в дальности своего
 * огнестрела; раненый или услышавший выстрел сначала поворачивается в примерную сторону. Берёт в руки
 * лучший ствол под дистанцию, реагирует с задержкой, целится (конус сужается, пока стоит) и
 * стреляет, когда конус у цели достаточно узкий; очередями с паузами (отдача успевает спасть),
 * перезаряжается, не стреляет, если на линии огня свой. ГО после боя снова берёт дубинку.
 */
export class Gunner {
  target: Character | null = null;
  /** Не стрелять (скрытная вылазка): цель ведёт и смотрит на неё, но огня не открывает. */
  holdFire = false;
  private reaction = 0;
  private burst = 0;
  private pause = 0;
  private scan = 0;
  private lostFor = 0;
  private calm = 0;
  /** Тревога: куда (примерно) смотреть, с какого момента и до какого. */
  private alert: { x: number; y: number; at: number; until: number } | null = null;
  private seenHurt = -1e9;
  private heardUntil = -1e9;

  constructor(private readonly rng: Rng) {}

  /** Видит ли self точку: вплотную — во все стороны, дальше — только в угле обзора. */
  static inView(self: Character, x: number, y: number): boolean {
    const d = Math.hypot(x - self.x, y - self.y);
    if (d <= VISION.npcCloseAwareness) return true;
    return Math.abs(angleDiff(Math.atan2(y - self.y, x - self.x), self.facing)) <= (VISION.npcFovDeg * DEG) / 2;
  }

  acquire(self: Character, ctx: AiContext): Character | null {
    const range = ctx.combat.maxRange(self);
    if (range <= 0) return null;
    let best: Character | null = null;
    let bestD = range;
    for (const o of ctx.entities.near(self.x, self.y, range, near)) {
      if (!ctx.combat.threat(self, o)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD && Gunner.inView(self, o.x, o.y) && canSeeCircle(ctx.map, self.x, self.y, o.x, o.y, o.radius)) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Есть ли на линии огня свой (не враг цели). */
  private friendInLine(self: Character, t: Character, ctx: AiContext): boolean {
    const mx = (self.x + t.x) / 2;
    const my = (self.y + t.y) / 2;
    const half = Math.hypot(t.x - self.x, t.y - self.y) / 2;
    for (const o of ctx.entities.near(mx, my, half + 14, near)) {
      if (o === self || o === t || ctx.combat.isHostile(self, o)) continue;
      if (pointSegmentDist2(o.x, o.y, self.x, self.y, t.x, t.y) < (o.radius + 3) ** 2) return true;
    }
    return false;
  }

  /** Вне боя ГО возвращает в руки дубинку (как на серверах: огнестрел — только по делу). */
  private holster(self: Character, ctx: AiContext, dt: number): void {
    this.calm += dt;
    if (this.calm < COMBAT.ai.holsterAfter || self.faction !== 'cp' || self.weapon === 'stunstick') return;
    if (!self.inventory.has('stunstick') || self.brain === null) return;
    // Часовые и медики на КПП держат огнестрел наготове.
    const b = self.brain as { guardPost?: unknown; medicStation?: unknown };
    if (b.guardPost || b.medicStation) return;
    ctx.combat.equip(self, 'stunstick');
  }

  /** Поднять тревогу: смотреть в сторону (x, y) с ошибкой, после задержки реакции. */
  private raise(self: Character, x: number, y: number, now: number, reaction: readonly [number, number]): void {
    const err = Math.hypot(x - self.x, y - self.y) * COMBAT.ai.alertError;
    const at = now + this.rng.range(reaction[0], reaction[1]);
    this.alert = { x: x + this.rng.range(-err, err), y: y + this.rng.range(-err, err), at, until: at + COMBAT.ai.alertTime };
  }

  /** Боль и звуки: ранили — в сторону стрелка; выстрел врага рядом — туда же; выстрел своего — куда он целится. */
  private sense(self: Character, ctx: AiContext): void {
    const combat = ctx.combat;
    const now = combat.now;
    if (self.lastHurt > this.seenHurt) {
      this.seenHurt = self.lastHurt;
      const a = self.lastAttacker;
      if (a && a.alive && a !== this.target) this.raise(self, a.x, a.y, now, COMBAT.ai.hurtReaction);
    }
    if (this.target || now < this.heardUntil) return;
    const shots = combat.shots;
    for (let i = shots.length - 1; i >= 0 && now - shots[i].t < 0.35; i--) {
      const s = shots[i];
      if (s.shooter === self || !s.shooter.alive) continue;
      if (Math.hypot(s.x - self.x, s.y - self.y) > Math.min(COMBAT.hearing, s.noise)) continue;
      if (combat.isHostile(self, s.shooter)) this.raise(self, s.x, s.y, now, COMBAT.ai.hearReaction);
      else if (!differentSides(self, s.shooter)) {
        const f = s.shooter.facing;
        this.raise(self, s.x + Math.cos(f) * COMBAT.ai.allyAimPoint, s.y + Math.sin(f) * COMBAT.ai.allyAimPoint, now, COMBAT.ai.hearReaction);
      } else continue;
      this.heardUntil = now + COMBAT.ai.alertTime * 0.5;
      return;
    }
  }

  /**
   * Куда смотреть: на цель, иначе — в сторону тревоги (после реакции). false — решает мозг.
   * Мозги зовут это последним, чтобы бой и тревога перебивали «дежурный» взгляд.
   */
  look(self: Character, ctx: AiContext, dt: number): boolean {
    if (this.target?.alive) {
      faceTowards(self, this.target.x, this.target.y, dt);
      return true;
    }
    const a = this.alert;
    const now = ctx.combat.now;
    if (a && now >= a.at && now < a.until) {
      faceTowards(self, a.x, a.y, dt);
      return true;
    }
    return false;
  }

  /** Встревожен (ищет стрелка глазами). */
  get alerted(): boolean {
    return this.alert !== null;
  }

  /** Ведёт бой: true, если есть цель (даже если сейчас пауза/перезарядка). */
  update(self: Character, ctx: AiContext, dt: number): boolean {
    const combat = ctx.combat;
    if (this.alert && combat.now >= this.alert.until) this.alert = null;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.3;
      this.sense(self, ctx);
      const t = this.acquire(self, ctx);
      if (t && t !== this.target) {
        this.target = t;
        this.alert = null;
        this.reaction = this.rng.range(COMBAT.ai.reaction[0], COMBAT.ai.reaction[1]);
      }
    }
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      self.aiming = false;
      this.holster(self, ctx, dt);
      return false;
    }
    this.calm = 0;
    const d = Math.hypot(t.x - self.x, t.y - self.y);
    // Ствол под дистанцию (дубинку — на огнестрел, пустой — на заряженный).
    if (!combat.reloading(self)) {
      const best = combat.bestWeapon(self, d);
      if (best && best !== self.weapon) combat.equip(self, best);
    }
    const w = combat.weaponOf(self);
    if (!w || w.mode === 'melee') {
      self.aiming = false;
      return true;
    }
    if (d > w.range * 1.1 || !canSeeCircle(ctx.map, self.x, self.y, t.x, t.y, t.radius)) {
      this.lostFor += dt;
      self.aiming = false;
      if (this.lostFor > 3) this.target = null;
      if (self.mag < w.magazine / 2) combat.reload(self);
      return this.target !== null;
    }
    this.lostFor = 0;
    self.aiming = true;
    faceTowards(self, t.x, t.y, dt);
    if (this.reaction > 0) {
      this.reaction -= dt;
      return true;
    }
    if (self.mag <= 0) {
      combat.reload(self);
      return true;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) this.burst = this.burstFor(w.mode);
      return true;
    }
    if (this.burst <= 0) this.burst = this.burstFor(w.mode);
    // Стреляет, когда конус у цели достаточно узкий (или уже целится изо всех сил) и не слишком далеко.
    const width = d * Math.tan(combat.spreadOf(self, w) * DEG);
    const steady = width <= t.radius * COMBAT.ai.fireWidth || self.aim >= 0.95;
    const inReach = d <= Math.min(w.range, w.effectiveRange * COMBAT.ai.maxRangeMul);
    if (!this.holdFire && steady && inReach && combat.canFire(self) && !this.friendInLine(self, t, ctx)) {
      combat.fire(self, t.x + t.vx * 0.1, t.y + t.vy * 0.1);
      this.burst--;
      if (this.burst <= 0) this.pause = this.rng.range(COMBAT.ai.burstPause[0], COMBAT.ai.burstPause[1]);
    }
    return true;
  }

  private burstFor(mode: keyof typeof BURST_BY_MODE): number {
    const [a, b] = BURST_BY_MODE[mode];
    return this.rng.int(a, b);
  }
}

/** Длина «очереди» по режиму огня: автомат — очередь, полуавтомат — серия, помпа/арбалет — по одному. */
const BURST_BY_MODE = {
  auto: COMBAT.ai.burst,
  semi: [1, 3] as const,
  pump: [1, 1] as const,
  melee: [1, 1] as const,
} satisfies Record<(typeof WEAPONS)[keyof typeof WEAPONS]['mode'], readonly [number, number]>;
