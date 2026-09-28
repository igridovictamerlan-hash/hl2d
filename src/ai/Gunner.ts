import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Rng } from '../core/rng';
import { canSeeCircle } from '../world/visibility';
import { faceTowards } from './facing';
import { COMBAT, GRENADE, ROCKET } from '../config/combat';
import { T } from '../world/tiles';
import { castRay, castRayWith } from '../world/visibility';
import { VISION } from '../config/vision';
import { WEAPONS } from '../config/items';
import { pointSegmentDist2 } from '../core/math';
import { FACTIONS } from '../config/factions';
import { angleDiff } from '../systems/CombatSystem';
import { bark } from '../systems/Barks';
import { SUPPRESS, DOWNED, TACTICS } from '../config/tactics';

const near: Character[] = [];
const DEG = Math.PI / 180;
/** Судьба лежащего раненого: добивает ли его каждая сторона (решается раз за падение). */
const finishFate = new WeakMap<Character, { at: number; sides: Partial<Record<'ota' | 'rebel' | 'cp', boolean>> }>();

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
  /** Где последний раз видели цель; когда можно снова думать о гранате. */
  private lastSeen = { x: 0, y: 0, t: -1e9 };
  private nadeCheck = 0;
  private nextNade = 0;
  private nextSmoke = 0;
  /** РПГ: взят для выстрела до этого времени (потом — обратно на автомат). */
  private rocketUntil = 0;
  private nextRocket = 0;
  /** Сколько секунд помнит цель, пропавшую из виду (тактика в укрытии держит дольше). */
  memory = 3;
  /** Цель — лежащий враг, которого решил добить. */
  private finishing = false;

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
    let downed: Character | null = null;
    let downedD = range * 0.6;
    // Подпольщик под личиной, которому можно стрелять, сам выбирает цели из Альянса (его пока не узнают).
    const covert = self.faction === 'rebel' && self.disguised && !this.holdFire;
    for (const o of ctx.entities.near(self.x, self.y, range, near)) {
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (o.downed) {
        // Лежащий враг — не угроза; добить, если больше не в кого (решается раз на каждого).
        if (d < downedD && ctx.combat.isHostile(self, o) && Gunner.inView(self, o.x, o.y) && canSeeCircle(ctx.map, self.x, self.y, o.x, o.y, o.radius)) {
          downedD = d;
          downed = o;
        }
        continue;
      }
      if (!ctx.combat.threat(self, o) && !(covert && o.alive && FACTIONS[o.faction].authority)) continue;
      // Присевший за бетонным блоком не виден (пока не выстрелит).
      if (d < bestD && Gunner.inView(self, o.x, o.y) && canSeeCircle(ctx.map, self.x, self.y, o.x, o.y, o.radius) && !ctx.combat.concealed(o, self.x, self.y)) {
        bestD = d;
        best = o;
      }
    }
    this.finishing = false;
    if (!best && downed && !this.holdFire && this.wantsFinish(self, downed, ctx)) {
      this.finishing = true;
      return downed;
    }
    return best;
  }

  /**
   * Добить ли лежащего врага: решается раз на лежащего и сторону (OTA чаще, повстанцы реже, ГО —
   * только на фронте, в городе задерживает).
   */
  private wantsFinish(self: Character, o: Character, ctx: AiContext): boolean {
    const side = self.faction === 'ota' || self.faction === 'rebel' || self.faction === 'cp' ? self.faction : null;
    if (!side) return false;
    let fate = finishFate.get(o);
    if (!fate || fate.at !== o.downedAt) {
      fate = { at: o.downedAt, sides: {} };
      finishFate.set(o, fate);
    }
    let v = fate.sides[side];
    if (v === undefined) {
      const front = ctx.map.zoneAtWorld(o.x, o.y)?.kind;
      const cpFront = front === 'checkpoint' || front === 'outlands' || front === 'wasteland';
      v = (side !== 'cp' || cpFront) && this.rng.chance(DOWNED.finish[side]);
      fate.sides[side] = v;
    }
    return v;
  }

  /** Где последний раз видел цель и когда (тактика: куда выглядывать, куда давить огнём). */
  get lastSeenAt(): { x: number; y: number; t: number } {
    return this.lastSeen;
  }

  /** Есть ли на линии огня свой (не враг цели). */
  private friendInLine(self: Character, t: Character, ctx: AiContext): boolean {
    const mx = (self.x + t.x) / 2;
    const my = (self.y + t.y) / 2;
    const half = Math.hypot(t.x - self.x, t.y - self.y) / 2;
    for (const o of ctx.entities.near(mx, my, half + 14, near)) {
      // Лежащий свой — пули идут поверх.
      if (o === self || o === t || o.downed || ctx.combat.isHostile(self, o)) continue;
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
      bark(self, 'hurt', now, this.rng);
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
        if (!this.target && !t.downed) bark(self, 'contact', combat.now, this.rng);
        this.target = t;
        this.alert = null;
        // Под огнём реагирует медленнее.
        this.reaction = this.rng.range(COMBAT.ai.reaction[0], COMBAT.ai.reaction[1]) * (1 + self.suppress * SUPPRESS.reactionMul);
      }
    }
    const t = this.target;
    // Цель упала (тяжело ранена) — не угроза, если не решил добить.
    if (!t || !t.alive || (t.downed && !this.finishing)) {
      this.target = null;
      self.aiming = false;
      this.holster(self, ctx, dt);
      return false;
    }
    this.calm = 0;
    self.engagedUntil = combat.now + 2.5;
    const d = Math.hypot(t.x - self.x, t.y - self.y);
    const now = combat.now;
    // Вплотную и с ножом — режет (бандит, партизан), если огнестрела нет или враг уже рядом.
    const reach = t.radius + self.radius + WEAPONS.knife.range - 2;
    if (d < reach && self.inventory.has('knife') && !this.holdFire && (self.profession === 'bandit' || !combat.bestWeapon(self, d))) {
      if (self.weapon !== 'knife') combat.equip(self, 'knife');
      faceTowards(self, t.x, t.y, dt);
      if (combat.canFire(self)) combat.fire(self, t.x, t.y);
      return true;
    }
    // РПГ: по укрытию или кучке врагов издалека.
    this.nadeCheck -= dt;
    if (this.nadeCheck <= 0) {
      this.nadeCheck = GRENADE.ai.check;
      if (now >= this.nextRocket && now >= this.rocketUntil && this.wantsRocket(self, t, d, ctx)) {
        this.rocketUntil = now + 4;
        combat.equip(self, 'rpg');
        if (self.mag <= 0) combat.reload(self);
      } else if (this.trySmoke(self, t, d, ctx) || this.tryGrenade(self, t, ctx)) return true;
    }
    const rocket = now < this.rocketUntil && self.weapon === 'rpg';
    // Ствол под дистанцию (дубинку — на огнестрел, пустой — на заряженный).
    if (!rocket && !combat.reloading(self) && !this.holdFire) {
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
      if (this.lostFor > this.memory) this.target = null;
      if (self.mag < w.magazine / 2) combat.reload(self);
      return this.target !== null;
    }
    this.lostFor = 0;
    this.lastSeen.x = t.x;
    this.lastSeen.y = t.y;
    this.lastSeen.t = combat.now;
    self.aiming = true;
    faceTowards(self, t.x, t.y, dt);
    if (this.reaction > 0) {
      this.reaction -= dt;
      return true;
    }
    if (self.mag <= 0) {
      if (combat.reload(self)) bark(self, 'reload', combat.now, this.rng);
      return true;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) this.burst = this.burstFor(w.mode);
      return true;
    }
    // Прижат огнём — стреляет вслепую короткими очередями, не дожидаясь сведения конуса.
    const pinned = self.suppress >= SUPPRESS.pinned;
    if (this.burst <= 0) this.burst = pinned ? this.rng.int(SUPPRESS.blindBurst[0], SUPPRESS.blindBurst[1]) : this.burstFor(w.mode);
    // Стреляет, когда конус у цели достаточно узкий (или уже целится изо всех сил) и не слишком далеко.
    const width = d * Math.tan(combat.spreadOf(self, w) * DEG);
    const steady = width <= t.radius * COMBAT.ai.fireWidth || self.aim >= 0.95 || (pinned && self.aim >= 0.3);
    const inReach = d <= Math.min(w.range, w.effectiveRange * COMBAT.ai.maxRangeMul);
    if (!this.holdFire && steady && inReach && combat.canFire(self) && !this.friendInLine(self, t, ctx)) {
      // Упреждение по скорости цели (пуля летит не мгновенно).
      const lead = d / w.speed;
      combat.fire(self, t.x + t.vx * lead, t.y + t.vy * lead);
      if (rocket) {
        this.rocketUntil = 0;
        this.nextRocket = combat.now + this.rng.range(ROCKET.cooldown[0], ROCKET.cooldown[1]);
        self.say(FACTIONS[self.faction].authority ? 'Ракета!' : 'Выстрел! Ложись!', combat.now, 1.5);
      }
      this.burst--;
      if (this.burst <= 0) this.pause = this.rng.range(COMBAT.ai.burstPause[0], COMBAT.ai.burstPause[1]);
    }
    return true;
  }

  /**
   * РПГ (Патрик, OTA.KING): цель не ближе ROCKET.minDist, за блоком или врагов кучка (≥ crowd),
   * своих у цели нет; в ракетах есть патрон.
   */
  private wantsRocket(self: Character, t: Character, d: number, ctx: AiContext): boolean {
    const combat = ctx.combat;
    if (this.holdFire || !self.inventory.has('rpg') || !combat.hasAmmo(self, 'rpg')) return false;
    if (d < ROCKET.minDist || d > WEAPONS.rpg.range * 0.8) return false;
    const R = GRENADE.radius * (WEAPONS.rpg.blastMul ?? 1);
    let crowd = 0;
    for (const o of ctx.entities.near(t.x, t.y, R, near)) {
      if (o === self || !o.alive) continue;
      if (combat.isHostile(self, o)) crowd++;
      else return false;
    }
    let behindBlock = false;
    const dx = (t.x - self.x) / d;
    const dy = (t.y - self.y) / d;
    castRayWith(ctx.map, self.x, self.y, dx, dy, d, (x, y, tt) => {
      if (ctx.map.blocksShot(x, y)) return true;
      if (tt > COMBAT.ownCoverDistance && ctx.map.tileAt(x, y) === T.BARRIER) behindBlock = true;
      return behindBlock;
    });
    return behindBlock || crowd >= ROCKET.crowd || t.maxHealth >= 150;
  }

  /**
   * Дым: ранен (ниже GRENADE.smoke.hurtBelow) и враг видит издалека — завеса между собой и ним.
   */
  private trySmoke(self: Character, t: Character, d: number, ctx: AiContext): boolean {
    const S = GRENADE.smoke;
    const combat = ctx.combat;
    const now = combat.now;
    if (now < this.nextSmoke || !combat.canThrow(self, 'smoke_grenade')) return false;
    if (self.health > self.maxHealth * S.hurtBelow || d < S.minDist) return false;
    if (!canSeeCircle(ctx.map, self.x, self.y, t.x, t.y, t.radius)) return false;
    if (!combat.throwGrenade(self, self.x + (t.x - self.x) * S.at, self.y + (t.y - self.y) * S.at, 'smoke_grenade')) return false;
    this.nextSmoke = now + this.rng.range(S.cooldown[0], S.cooldown[1]);
    self.say('Дым! Прикройте!', now, 1.5);
    return true;
  }

  /**
   * Граната: цель за укрытием (не видно после недавнего контакта или бетонный блок на линии) либо
   * врагов кучка; в своей дальности броска, своих у точки взрыва нет, сам вне радиуса.
   */
  private tryGrenade(self: Character, t: Character, ctx: AiContext): boolean {
    const combat = ctx.combat;
    const G = GRENADE;
    const now = combat.now;
    // Осколочная, иначе зажигательная (дымовая — не для этого).
    const kind = self.inventory.has('grenade') ? 'grenade' : self.inventory.has('fire_grenade') ? 'fire_grenade' : null;
    if (this.holdFire || !kind || now < this.nextNade || !combat.canThrow(self, kind)) return false;
    const visible = canSeeCircle(ctx.map, self.x, self.y, t.x, t.y, t.radius);
    if (!visible && now - this.lastSeen.t > 4) return false;
    const px = visible ? t.x : this.lastSeen.x;
    const py = visible ? t.y : this.lastSeen.y;
    const d = Math.hypot(px - self.x, py - self.y);
    if (d < G.ai.minDist || d > G.ai.maxDist) return false;
    const dx = (px - self.x) / d;
    const dy = (py - self.y) / d;
    let behindBlock = false;
    castRayWith(ctx.map, self.x, self.y, dx, dy, d, (x, y, tt) => {
      if (ctx.map.blocksShot(x, y)) return true;
      if (tt > COMBAT.ownCoverDistance && ctx.map.tileAt(x, y) === T.BARRIER) behindBlock = true;
      return behindBlock;
    });
    let crowd = 0;
    for (const o of ctx.entities.near(px, py, G.radius, near)) {
      if (o === self || !o.alive) continue;
      if (combat.isHostile(self, o)) crowd++;
      // Свои (и мирные) у точки взрыва — не бросаем.
      else return false;
    }
    // Подрывник бросает и в одиночную цель на виду (для него это работа).
    const demo = self.profession === 'demolitionist';
    if (visible && !behindBlock && crowd < (demo ? 1 : 2)) return false;
    // Куда граната реально упадёт (стена ближе — упадёт перед ней): не себе под ноги.
    const land = Math.min(d, castRay(ctx.map, self.x, self.y, dx, dy, d) - 8);
    if (land < G.radius + 12) return false;
    // Цель прижата огнём за укрытием — самое время для гранаты.
    const pressed = t.suppress >= SUPPRESS.pinned ? TACTICS.grenadeMul : 1;
    if (!this.rng.chance(Math.min(1, G.ai.chance * (demo ? G.ai.demoMul : 1) * pressed))) return false;
    if (!combat.throwGrenade(self, px, py, kind)) return false;
    this.nextNade = now + this.rng.range(G.ai.cooldown[0], G.ai.cooldown[1]) / (demo ? G.ai.demoMul : 1);
    self.say(FACTIONS[self.faction].authority ? 'Граната! Ложись!' : 'Лови подарок!', now, 1.5);
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
