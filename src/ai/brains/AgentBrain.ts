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
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorInZone } from '../destinations';
import { canSeeCircle } from '../../world/visibility';
import { coverAuthority } from '../../entities/cover';
import { cpUnit } from '../../config/factions';
import { CHARACTER } from '../../config/entities';
import { COMBAT } from '../../config/combat';
import { INSURGENCY, PARTISANS } from '../../config/underground';
import { poiWorld } from '../../systems/Population';

export type AgentMission = 'assassinate' | 'jailbreak' | 'riot';
export type AgentMode = 'base' | 'dress' | 'mission' | 'return';

/**
 * Спецагент сопротивления (один на сервер). Из схрона через люк: для покушения и взлома КПЗ сперва
 * переодевается — в убитого сотрудника Альянса (свежее тело в городе) или в OTA у шкафа в казарме
 * Нексуса; в личине сотрудника Альянса свои его не проверяют. Миссии: покушение на Администратора и
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
  private dressAt: Vec2 | null = null;
  private work = 0;
  private fightUntil = 0;
  private restUntil: number;
  private repath = 0;
  private idle = 0;
  /** Ставит растяжку у выбитой двери (прикрыть побег) — потом домой. */
  private planting = false;
  /** Итоги (для тестов и отладки). */
  stats = { dressed: 0, assassinations: 0, jailbreaks: 0, riots: 0 };

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
    // Свой в клетке — вытащить.
    if (!m && ctx.insurgency.comradeCaged() && ctx.rng.chance(PARTISANS.rescueChance)) m = 'jailbreak';
    if (!m) {
      const r = ctx.rng.next();
      m = r < W.assassinate ? 'assassinate' : r < W.assassinate + W.jailbreak ? 'jailbreak' : 'riot';
    }
    this.mission = m;
    this.target = null;
    this.cell = null;
    if (m === 'assassinate') {
      this.target = this.pickTarget(ctx);
      if (!this.target) return false;
    } else if (m === 'jailbreak') {
      this.cell = ctx.law.cells.find((c) => c.cage && c.slots.some((s) => s.occupant)) ?? ctx.law.cells.find((c) => c.slots.some((s) => s.occupant)) ?? null;
      if (!this.cell) return false;
    }
    // Покушение и взлом — в личине сотрудника Альянса; бунт — и под видом горожанина.
    if (m !== 'riot' && !coverAuthority(self)) this.beginDress(self, ctx);
    else this.beginMission(self, ctx);
    return true;
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
      if ((c.faction !== 'cp' && c.faction !== 'ota') || c.stripped || c.burning || c.until - now < COMBAT.corpseTime - A.corpseFresh) continue;
      if (ctx.map.levelAt(c.x, c.y) !== 'city') continue;
      const d = Math.hypot(c.x - self.x, c.y - self.y);
      if (d < bestD) {
        bestD = d;
        this.corpse = c;
      }
    }
    const spots = ctx.map.poisOf('ota_spot').length;
    this.dressAt = this.corpse ? { x: this.corpse.x, y: this.corpse.y } : spots ? poiWorld(ctx, 'ota_spot', Math.floor(ctx.rng.next() * spots)) : null;
    if (!this.dressAt) {
      this.goHome(self, ctx);
      return;
    }
    this.mode = 'dress';
    this.work = 0;
    this.travel.start(self, ctx, this.mover, this.dressAt);
  }

  private beginMission(self: Character, ctx: AiContext): void {
    this.mode = 'mission';
    this.work = 0;
    this.fightUntil = 0;
    const to = this.missionPoint(ctx);
    if (!to) {
      this.goHome(self, ctx);
      return;
    }
    this.travel.start(self, ctx, this.mover, to);
  }

  private missionPoint(ctx: AiContext): Vec2 | null {
    if (this.mission === 'assassinate') return this.target?.alive ? { x: this.target.x, y: this.target.y } : null;
    if (this.mission === 'jailbreak') return this.cell ? { x: this.cell.frontX, y: this.cell.frontY } : null;
    const plaza = poiWorld(ctx, 'plaza_center');
    const a = plaza ? ctx.nav.nearestWalkable(plaza.x + ctx.rng.range(-60, 60), plaza.y + ctx.rng.range(-60, 60), 6) : randomAnchorInZone(ctx, 'avenue');
    return a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : null;
  }

  private goHome(self: Character, ctx: AiContext): void {
    this.planting = false;
    this.mode = 'return';
    this.mission = null;
    this.target = null;
    this.cell = null;
    this.mover.speed = CHARACTER.runSpeed * 0.8;
    const base = ctx.insurgency.base;
    if (base) this.travel.start(self, ctx, this.mover, base);
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    if (self.disguised && complyWithCp(self, this.mover, dt)) return;
    const A = PARTISANS.agent;
    const now = ctx.combat.now;
    // Скрытен: стреляет только на покушении или если ранили.
    const hurt = now - self.lastHurt < INSURGENCY.returnFireFor;
    this.gunner.holdFire = !(hurt || (this.mode === 'mission' && this.mission === 'assassinate' && this.fightUntil > 0));
    const fighting = this.gunner.update(self, ctx, dt);
    // Под личиной ствол в кармане, пока не стреляет.
    if (self.disguised && !this.gunner.target && self.weapon) ctx.combat.equip(self, null);
    this.repath -= dt;
    if (self.health < self.maxHealth * COMBAT.woundedFraction && this.mode !== 'base' && this.mode !== 'return') this.goHome(self, ctx);

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
        if (ctx.map.levelAt(self.x, self.y) === 'city' && Math.hypot(at.x - self.x, at.y - self.y) < A.reach) {
          this.travel.stop(this.mover);
          this.work += dt;
          if (this.work >= A.dress) {
            if (this.corpse && !this.corpse.stripped) ctx.insurgency.dressAs(self, this.corpse);
            else ctx.insurgency.dressAsOta(self);
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

  private updateMission(self: Character, ctx: AiContext, dt: number, fighting: boolean): void {
    const A = PARTISANS.agent;
    const now = ctx.combat.now;
    const city = ctx.map.levelAt(self.x, self.y) === 'city';
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
    const to = this.mission === 'jailbreak' && this.cell ? { x: this.cell.frontX, y: this.cell.frontY } : this.travel.goal;
    const st = this.travel.update(self, ctx, this.mover, dt);
    if (city && to && (st === 'arrived' || Math.hypot(to.x - self.x, to.y - self.y) < A.reach)) {
      this.travel.stop(this.mover);
      if (this.mission === 'jailbreak' && this.cell) faceTowards(self, this.cell.x, this.cell.y, dt);
      this.work += dt;
      const need = this.mission === 'jailbreak' ? A.breakTime : A.dress;
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
        }
        this.goHome(self, ctx);
      }
    } else if (st === 'failed') this.goHome(self, ctx);
  }
}
