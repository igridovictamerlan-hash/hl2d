import { ARSENAL } from '../../config/arsenal';
import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import type { Corpse } from '../../systems/CombatSystem';
import type { Cell } from '../../systems/LawSystem';
import { Mover } from '../Mover';
import { complyWithCp } from '../comply';
import { Gunner } from '../Gunner';
import { HatchTravel } from '../HatchTravel';
import { PrisonAssault } from '../PrisonAssault';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorInZone } from '../destinations';
import { canSeeCircle } from '../../world/visibility';
import { coverAuthority } from '../../entities/cover';
import { cpUnit } from '../../config/factions';
import { CHARACTER } from '../../config/entities';
import { COMBAT } from '../../config/combat';
import { INSURGENCY, PARTISANS } from '../../config/underground';
import { poiWorld } from '../../systems/Population';

export type AgentMission = 'assassinate' | 'jailbreak' | 'riot' | 'requisition' | 'prison';
export type AgentMode = 'base' | 'dress' | 'mission' | 'return';

/**
 * Спецагент сопротивления (один на сервер). Из схрона через люк: для покушения и взлома КПЗ сперва
 * переодевается в форму убитого ВС (свежее тело в городе; в OTA — никогда); в форме ВС свои его не
 * проверяют. Свежего тела нет — идёт под своей гражданской личиной («по наряду» без формы не выдадут —
 * тогда бунт). Миссии: покушение на Коменданта и
 * высших чинов (CMD.EPU, SU.INSP, PCU.OFC) — вплотную достаёт ствол (маскировка слетает) и стреляет;
 * взлом камеры КПЗ или клетки — все сбегают; бунт горожан на площади. Потом — к люку и вниз.
 */
export class AgentBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed);
  readonly gunner: Gunner;
  readonly travel = new HatchTravel();
  mode: AgentMode = 'base';
  mission: AgentMission | null = null;
  target: Character | null = null;
  cell: Cell | null = null;
  private corpse: Corpse | null = null;
  /** До какого времени миссия (застрял — домой). */
  private missionUntil = 0;
  /** Точка миссии (у HatchTravel цель после прибытия сбрасывается). */
  private missionAt: Vec2 | null = null;
  private dressAt: Vec2 | null = null;
  private work = 0;
  /** Покушение идёт до этого времени (0 — ещё не стреляли). */
  fightUntil = 0;
  /** Пара: второй спецагент идёт прикрытием за ведущим (backup — это я прикрываю partner). */
  partner: Character | null = null;
  backup = false;
  private restUntil: number;
  private repath = 0;
  private idle = 0;
  /** Ставит растяжку у выбитой двери (прикрыть побег) — потом домой. */
  private planting = false;
  /** Штурм тюрьмы вместе с подпольем (миссия prison). */
  private assault: PrisonAssault | null = null;
  /** Итоги (для тестов и отладки). */
  stats = { dressed: 0, assassinations: 0, jailbreaks: 0, riots: 0, requisitions: 0 };

  constructor(self: Character, ctx: AiContext) {
    this.gunner = new Gunner(ctx.rng);
    this.restUntil = ctx.combat.now + ctx.rng.range(PARTISANS.agent.rest[0], PARTISANS.agent.rest[1]);
    void self;
  }

  get stateName(): string {
    const m = this.mode === 'mission' ? this.mission ?? 'миссия' : this.mode;
    return `спецагент · ${m}${this.gunner.target ? ' · бой' : ''}`;
  }

  /** Начать миссию (или принудительно — тесты и отладка). */
  start(self: Character, ctx: AiContext, mission?: AgentMission): boolean {
    const A = PARTISANS.agent;
    const W = A.missions;
    let m = mission;
    // Свой в КПЗ — вытащить.
    if (!m && ctx.insurgency.jailbreakReady && ctx.insurgency.comradeCaged() && ctx.rng.chance(PARTISANS.rescueChance)) m = 'jailbreak';
    if (!m) {
      const r = ctx.rng.next();
      m = r < W.assassinate ? 'assassinate' : r < W.assassinate + W.jailbreak ? 'jailbreak' : r < W.assassinate + W.jailbreak + W.riot ? 'riot' : 'requisition';
      // Взлом недавно был — вместо него бунт.
      if (m === 'jailbreak' && !ctx.insurgency.jailbreakReady) m = 'riot';
      // «По наряду» — только если склад есть и выдача открыта.
      if (m === 'requisition' && (!ctx.arsenal?.present || ctx.arsenal.closed || !ctx.arsenal.window)) m = 'riot';
    }
    this.mission = m;
    this.target = null;
    this.cell = null;
    this.backup = false;
    this.partner = null;
    if (m === 'assassinate') {
      this.target = this.pickTarget(ctx);
      if (!this.target) return false;
    } else if (m === 'jailbreak') {
      // Только КПЗ Управы: тюрьму берут штурмом всем подпольем (InsurgencySystem.startPrisonAssault).
      this.cell = ctx.insurgency.occupiedCell();
      if (!this.cell) return false;
      if (!this.backup) ctx.insurgency.markJailbreak();
    }
    // Покушение, взлом и «наряд» на складе — в личине сотрудника Протектората; бунт — и под видом горожанина.
    if (m !== 'riot' && !coverAuthority(self)) this.beginDress(self, ctx);
    else this.beginMission(self, ctx);
    // Покушение и взлом — парой: свободный второй спецагент идёт прикрытием.
    if (m === 'assassinate' || m === 'jailbreak') {
      const mate = ctx.insurgency.agents.find((o) => o !== self && o.alive && !o.isPlayer && o.brain instanceof AgentBrain && o.brain.mode === 'base' && o.law.phase === 'none');
      if (mate) {
        this.partner = mate;
        (mate.brain as AgentBrain).joinBackup(mate, ctx, self, m);
      }
    }
    return true;
  }

  /** Штурм тюрьмы с подпольем (InsurgencySystem.startPrisonAssault): к месту сбора — дальше PrisonAssault. */
  joinPrison(self: Character, ctx: AiContext, spot: Vec2): void {
    this.mission = 'prison';
    this.mode = 'mission';
    this.target = null;
    this.cell = null;
    this.backup = false;
    this.partner = null;
    this.assault = new PrisonAssault(spot);
    this.missionUntil = ctx.combat.now + PARTISANS.agent.missionMax;
    this.mover.speed = CHARACTER.walkSpeed * PARTISANS.briskWalk;
    this.travel.start(self, ctx, this.mover, spot);
  }

  /** Прикрыть ведущего спецагента на его миссии: переодеться (если надо) и держаться рядом. */
  joinBackup(self: Character, ctx: AiContext, lead: Character, mission: AgentMission): void {
    const lb = lead.brain as AgentBrain;
    this.mission = mission;
    this.backup = true;
    this.partner = lead;
    this.target = lb.target;
    this.cell = lb.cell;
    this.fightUntil = 0;
    self.say(ctx.rng.pick(PARTISANS.lines.backup), ctx.law.now, 2);
    ctx.insurgency.radio(`спецагенты идут парой: ${mission === 'assassinate' ? 'покушение' : 'взлом'} — второй прикрывает.`);
    if (!coverAuthority(self)) this.beginDress(self, ctx);
    else this.beginMission(self, ctx);
  }

  private pickTarget(ctx: AiContext): Character | null {
    let best: Character | null = null;
    let bestScore = 0;
    for (const o of ctx.entities.list) {
      if (!o.alive || ctx.map.levelAt(o.x, o.y) !== 'city') continue;
      const score = o.faction === 'admin' ? 10 : o.faction === 'cp' ? cpUnit(o.rank).command - 3 : 0;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private beginDress(self: Character, ctx: AiContext): void {
    const A = PARTISANS.agent;
    const now = ctx.combat.now;
    this.corpse = null;
    let bestD = Infinity;
    for (const c of ctx.combat.corpses) {
      if (c.faction !== 'cp' || c.stripped || c.burning || c.until - now < COMBAT.corpseTime - A.corpseFresh) continue;
      if (ctx.map.levelAt(c.x, c.y) !== 'city') continue;
      const d = Math.hypot(c.x - self.x, c.y - self.y);
      if (d < bestD) {
        bestD = d;
        this.corpse = c;
      }
    }
    this.dressAt = this.corpse ? { x: this.corpse.x, y: this.corpse.y } : null;
    if (!this.dressAt) {
      this.goUndressed(self, ctx);
      return;
    }
    this.mode = 'dress';
    this.work = 0;
    this.travel.start(self, ctx, this.mover, this.dressAt);
  }

  /** Формы не достать: покушение и взлом — под гражданской личиной, «по наряду» без формы — бунт. */
  private goUndressed(self: Character, ctx: AiContext): void {
    if (this.mission === 'requisition') this.mission = 'riot';
    this.beginMission(self, ctx);
  }

  private beginMission(self: Character, ctx: AiContext): void {
    this.mode = 'mission';
    this.missionUntil = ctx.combat.now + PARTISANS.agent.missionMax;
    this.work = 0;
    this.fightUntil = 0;
    const to = this.missionPoint(ctx);
    this.missionAt = to;
    if (!to) {
      this.goHome(self, ctx);
      return;
    }
    this.travel.start(self, ctx, this.mover, to);
  }

  private missionPoint(ctx: AiContext): Vec2 | null {
    if (this.backup) return this.partner?.alive ? { x: this.partner.x, y: this.partner.y } : null;
    if (this.mission === 'assassinate') return this.target?.alive ? { x: this.target.x, y: this.target.y } : null;
    if (this.mission === 'jailbreak') return this.cell ? { x: this.cell.frontX, y: this.cell.frontY } : null;
    if (this.mission === 'requisition') return ctx.arsenal.window;
    const plaza = poiWorld(ctx, 'plaza_center');
    const a = plaza ? ctx.nav.nearestWalkable(plaza.x + ctx.rng.range(-60, 60), plaza.y + ctx.rng.range(-60, 60), 6) : randomAnchorInZone(ctx, 'avenue');
    return a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : null;
  }

  /** Бросить миссию и уйти в схрон (например, отпустили из КПЗ). */
  retreat(self: Character, ctx: AiContext): void {
    if (this.mode === 'base') return;
    this.goHome(self, ctx);
  }

  private goHome(self: Character, ctx: AiContext): void {
    this.planting = false;
    this.mode = 'return';
    this.mission = null;
    this.target = null;
    this.cell = null;
    this.backup = false;
    this.partner = null;
    // Под личиной не бежит (бег — нарушение для ВС): быстрым шагом; раскрытый — бегом.
    this.mover.speed = self.disguised ? CHARACTER.walkSpeed * PARTISANS.briskWalk : CHARACTER.runSpeed * 0.8;
    const base = ctx.insurgency.base;
    if (base) this.travel.start(self, ctx, this.mover, base);
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    if (self.disguised && complyWithCp(self, this.mover, dt)) return;
    const A = PARTISANS.agent;
    const now = ctx.combat.now;
    // Скрытен: стреляет только на покушении или если ранили.
    const hurt = now - self.lastHurt < INSURGENCY.returnFireFor;
    const prison = this.mode === 'mission' && this.mission === 'prison';
    this.gunner.holdFire = prison
      ? PrisonAssault.holdFire(ctx.insurgency.groupOf(self), hurt)
      : !(hurt || (this.mode === 'mission' && this.mission === 'assassinate' && this.fightUntil > 0));
    const fighting = this.gunner.update(self, ctx, dt);
    // Под личиной ствол в кармане, пока не стреляет (огонь запрещён — тоже, даже если цель на виду).
    if (self.disguised && self.weapon && (!this.gunner.target || this.gunner.holdFire)) ctx.combat.equip(self, null);
    this.repath -= dt;
    const wounded = prison ? PrisonAssault.tooHurt(self, ctx.insurgency.groupOf(self)) : self.health < self.maxHealth * COMBAT.woundedFraction;
    if (wounded && this.mode !== 'base' && this.mode !== 'return') this.goHome(self, ctx);

    switch (this.mode) {
      case 'base': {
        if (now >= this.restUntil && ctx.insurgency.canRunAgent()) {
          this.restUntil = now + ctx.rng.range(A.rest[0], A.rest[1]);
          if (!this.start(self, ctx)) this.restUntil = now + 10;
          break;
        }
        this.idle -= dt;
        if (this.idle <= 0 && this.mover.status !== 'moving' && this.mover.status !== 'pending') {
          this.idle = ctx.rng.range(INSURGENCY.baseWander[0], INSURGENCY.baseWander[1]);
          const a = randomAnchorInZone(ctx, 'rebel_base');
          if (a >= 0) this.mover.goTo(self, ctx, a);
        }
        if (this.mover.status === 'arrived') this.mover.stop();
        break;
      }
      case 'dress': {
        const at = this.dressAt!;
        const st = this.travel.update(self, ctx, this.mover, dt);
        const d = Math.hypot(at.x - self.x, at.y - self.y);
        // Дошёл (или встал вплотную — тело у стены, место занято) — переодевается.
        const stopped = st === 'arrived' || st === 'idle';
        if (ctx.map.levelAt(self.x, self.y) === 'city' && (d < A.reach || (stopped && d < A.reach * 2.5))) {
          this.travel.stop(this.mover);
          this.work += dt;
          if (this.work >= A.dress) {
            // Форму успели снять другие — идёт как есть.
            if (!this.corpse || this.corpse.stripped) {
              this.goUndressed(self, ctx);
              break;
            }
            ctx.insurgency.dressAs(self, this.corpse);
            this.stats.dressed++;
            this.beginMission(self, ctx);
          }
        } else if (st === 'failed') this.goHome(self, ctx);
        break;
      }
      case 'mission':
        if (this.planting) {
          this.mover.stop();
          if (!ctx.combat.busy(self)) {
            this.planting = false;
            this.goHome(self, ctx);
          }
          break;
        }
        this.updateMission(self, ctx, dt, fighting);
        break;
      case 'return': {
        const st = this.travel.update(self, ctx, this.mover, dt);
        if (st === 'arrived' || (st === 'failed' && ctx.map.levelAt(self.x, self.y) === 'sewer')) {
          this.travel.stop(this.mover);
          this.mode = 'base';
          this.mover.speed = CHARACTER.walkSpeed;
        } else if (st === 'failed' || st === 'idle') {
          if (this.repath <= 0) {
            this.repath = 2;
            this.goHome(self, ctx);
          }
        }
        break;
      }
    }
    if (!this.travel.climbing) this.mover.update(self, ctx, dt);
    if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
  }

  /**
   * Прикрытие ведущего: держаться в backupGap px за ним; ведущий открыл огонь по цели — тоже огонь;
   * ведущий ушёл или погиб — к люку.
   */
  private updateBackup(self: Character, ctx: AiContext, dt: number, fighting: boolean): void {
    const p = this.partner;
    const pb = p?.brain instanceof AgentBrain ? p.brain : null;
    const now = ctx.combat.now;
    if (!p || !p.alive || !pb || pb.mode === 'return' || pb.mode === 'base') {
      this.goHome(self, ctx);
      return;
    }
    const t = pb.target ?? this.target;
    if (this.mission === 'assassinate' && pb.fightUntil > 0 && t?.alive) {
      // Ведущий стреляет — поддержать огнём.
      this.target = t;
      this.fightUntil = pb.fightUntil;
      if (!this.gunner.target) {
        const w = ctx.combat.bestWeapon(self, Math.hypot(t.x - self.x, t.y - self.y));
        if (w) ctx.combat.equip(self, w);
        this.gunner.target = t;
      }
      if (fighting && this.gunner.target) this.mover.stop();
      else if (this.repath <= 0) {
        this.repath = 1;
        const a = ctx.nav.nearestWalkable(t.x, t.y, 3);
        if (a >= 0) this.mover.goTo(self, ctx, a);
      }
      return;
    }
    if (now > this.fightUntil && this.fightUntil > 0) {
      this.goHome(self, ctx);
      return;
    }
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    const same = ctx.map.levelAt(p.x, p.y) === ctx.map.levelAt(self.x, self.y);
    if (same && d < PARTISANS.agent.backupGap) {
      this.travel.stop(this.mover);
      faceTowards(self, p.x, p.y, dt);
      return;
    }
    if (this.repath <= 0 && !this.travel.climbing) {
      this.repath = 2;
      this.travel.start(self, ctx, this.mover, { x: p.x, y: p.y });
    }
    if (this.travel.update(self, ctx, this.mover, dt) === 'failed' && this.repath <= 0) this.goHome(self, ctx);
  }

  private updateMission(self: Character, ctx: AiContext, dt: number, fighting: boolean): void {
    const A = PARTISANS.agent;
    const now = ctx.combat.now;
    const city = ctx.map.levelAt(self.x, self.y) === 'city';
    if (this.backup) {
      this.updateBackup(self, ctx, dt, fighting);
      return;
    }
    if (this.mission === 'prison') {
      if (!this.assault || !this.assault.step(self, ctx, ctx.insurgency.groupOf(self), this.travel, this.mover, this.gunner, dt, fighting)) {
        this.assault = null;
        this.goHome(self, ctx);
      }
      return;
    }
    if (this.mission === 'assassinate') {
      const t = this.target;
      if (!t || !t.alive) {
        if (t && this.fightUntil > 0) {
          this.stats.assassinations++;
          self.say(ctx.rng.pick(PARTISANS.lines.kill), now, 2);
        }
        this.goHome(self, ctx);
        return;
      }
      if (this.fightUntil > 0) {
        // Покушение идёт: стоит и стреляет, пока цель жива (не дольше fight с).
        if (now > this.fightUntil) this.goHome(self, ctx);
        else if (fighting && this.gunner.target) this.mover.stop();
        else if (this.repath <= 0) {
          this.repath = 1;
          const a = ctx.nav.nearestWalkable(t.x, t.y, 3);
          if (a >= 0) this.mover.goTo(self, ctx, a);
        }
        return;
      }
      const d = Math.hypot(t.x - self.x, t.y - self.y);
      if (city && d < A.shootAt && canSeeCircle(ctx.map, self.x, self.y, t.x, t.y, t.radius)) {
        // Вплотную — ствол наружу и огонь; личину выдаст только убийство (CombatSystem.kill).
        this.travel.stop(this.mover);
        const w = ctx.combat.bestWeapon(self, d);
        if (w) ctx.combat.equip(self, w);
        this.gunner.target = t;
        this.fightUntil = now + A.fight;
        return;
      }
      const st = this.travel.update(self, ctx, this.mover, dt);
      if (city && !this.travel.climbing && this.repath <= 0) {
        this.repath = 2;
        this.travel.start(self, ctx, this.mover, { x: t.x, y: t.y });
      } else if (st === 'failed') this.goHome(self, ctx);
      return;
    }
    // Взлом: из камеры уже выпустили — к другой занятой.
    if (this.mission === 'jailbreak' && (!this.cell || !this.cell.slots.some((sl) => sl.occupant))) {
      const other = ctx.insurgency.occupiedCell();
      if (!other) {
        this.goHome(self, ctx);
        return;
      }
      this.cell = other;
      this.work = 0;
      this.travel.start(self, ctx, this.mover, { x: other.frontX, y: other.frontY });
    }
    // Миссия затянулась (не пройти, некуда) — уйти в схрон.
    if (now > this.missionUntil) {
      this.goHome(self, ctx);
      return;
    }
    const to = this.mission === 'jailbreak' && this.cell ? { x: this.cell.frontX, y: this.cell.frontY } : this.missionAt;
    const st = this.travel.update(self, ctx, this.mover, dt);
    const d = to ? Math.hypot(to.x - self.x, to.y - self.y) : Infinity;
    // Встал далеко (путь сорвался) — заново.
    if (city && to && st === 'idle' && d >= A.reach * 2.5 && this.repath <= 0) {
      this.repath = 2;
      this.travel.start(self, ctx, this.mover, to);
    }
    if (city && to && (st === 'arrived' || d < A.reach || (st === 'idle' && d < A.reach * 2.5))) {
      this.travel.stop(this.mover);
      if (this.mission === 'jailbreak' && this.cell) faceTowards(self, this.cell.x, this.cell.y, dt);
      this.work += dt;
      const need = this.mission === 'jailbreak' ? A.breakTime : this.mission === 'requisition' ? ARSENAL.issue.every : A.dress;
      if (this.work >= need) {
        if (this.mission === 'jailbreak' && this.cell) {
          if (ctx.insurgency.jailbreak(self, this.cell) > 0) this.stats.jailbreaks++;
          // Растяжка у двери — погоню встретит взрыв.
          if (ctx.combat.startPlant(self)) {
            this.planting = true;
            return;
          }
        } else if (this.mission === 'riot') {
          if (ctx.insurgency.startRiot(self, self.x, self.y) > 0) this.stats.riots++;
        } else if (this.mission === 'requisition') {
          // В форме Протектората «по наряду»: кладовщик выдаёт гранаты и записывает — это не кража.
          const n = ctx.arsenal.requisition(self);
          if (n > 0) {
            this.stats.requisitions++;
            ctx.insurgency.radio(`спецагент получил на складе Протектората «по наряду» гранат: ${n}.`);
          }
        }
        this.goHome(self, ctx);
      }
    } else if (st === 'failed') this.goHome(self, ctx);
  }
}

