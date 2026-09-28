import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import type { RepairSpot } from '../../systems/EconomySystem';
import type { Cell } from '../../systems/LawSystem';
import type { DepotAct } from '../../systems/Arsenal';
import { Mover } from '../Mover';
import { complyWithCp } from '../comply';
import { Gunner } from '../Gunner';
import { HatchTravel } from '../HatchTravel';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorInZone } from '../destinations';
import { COMBAT, MINE } from '../../config/combat';
import { CHARACTER } from '../../config/entities';
import { INSURGENCY, PARTISANS } from '../../config/underground';

export type OpMode = 'base' | 'sabotage' | 'arm' | 'jailbreak' | 'mine' | 'depot' | 'return' | 'outing';

/** Связь сопротивления: дело на складе сделано. */
const DEPOT_DONE: Record<DepotAct, string> = {
  steal: 'со склада Альянса унесён ящик — ГО недосчитается.',
  taint: 'в ящик патронов на площадке склада подмешан брак — у ГО будут осечки.',
  bomb: 'заряд у зала склада Альянса заложен — рванёт через 20 секунд.',
  beacon: 'маяк площадки склада испорчен — борт не сядет.',
};

/**
 * Боец убежища сопротивления в канализации.
 *  base — бродит по убежищу, защищает его;
 *  sabotage — через люк к узлу Альянса, возится INSURGENCY.sabotageTime с, уходит;
 *  arm — через люк к бандиту, отдать ствол (он пойдёт на ГО — чужими руками), назад; огня не открывает;
 *  jailbreak — под личиной через люк в Нексус к занятой камере или клетке, выбить дверь, у двери
 *    оставить растяжку (прикрыть побег) и уйти;
 *  mine — поставить растяжку (на свежем теле ГО, у ворот Нексуса, у выхода проходной, на пути патруля);
 *  depot — в робе грузчика на склад Альянса: унести ящик, подмешать брак, заложить заряд, испортить маяк;
 *  return — к ближайшему люку и вниз, в убежище (раненый — сразу сюда).
 */
export class UndergroundBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed * 0.9);
  readonly gunner: Gunner;
  readonly travel = new HatchTravel();
  mode: OpMode = 'base';
  /** Цель операции: узел Альянса или бандит, которому несут ствол. */
  node: RepairSpot | null = null;
  prey: Character | null = null;
  /** Взлом: камера; минирование: куда ставить; ставит растяжку — ждёт и уходит. */
  cell: Cell | null = null;
  spot: Vec2 | null = null;
  private planting = false;
  /** Дело на складе Альянса. */
  depotAct: DepotAct | null = null;
  private jailWait = 0;
  private work = 0;
  private idle = 0;
  private repath = 0;
  private outingWait = 0;
  private fromOuting = false;
  outingWhat = '';
  private homeAt = -1e9;

  constructor(self: Character, ctx: AiContext) {
    this.gunner = new Gunner(ctx.rng);
    void self;
  }

  get stateName(): string {
    const t = this.travel.climbing ? ' · люк' : '';
    return `${this.mode === 'outing' ? this.outingWhat : this.mode}${this.gunner.target ? ' · бой' : ''}${t}`;
  }

  /** Свободен ли для операции. */
  get available(): boolean {
    return this.mode === 'base';
  }

  startSabotage(self: Character, ctx: AiContext, node: RepairSpot): void {
    this.mode = 'sabotage';
    this.node = node;
    this.work = 0;
    this.mover.speed = CHARACTER.walkSpeed * 1.1;
    this.travel.start(self, ctx, this.mover, { x: node.x, y: node.y });
  }

  /**
   * Вылазка: дойти до точки (обход тоннелей, рынок или разведка в городе через люк),
   * постоять там, осматриваясь, и вернуться в убежище.
   */
  startOuting(self: Character, ctx: AiContext, to: Vec2, what: string): void {
    this.mode = 'outing';
    this.outingWhat = what;
    this.outingWait = ctx.rng.range(INSURGENCY.outingWait[0], INSURGENCY.outingWait[1]);
    this.mover.speed = CHARACTER.walkSpeed * 0.95;
    this.travel.start(self, ctx, this.mover, to);
  }

  /** Отнести ствол бандиту (партизан скрытен: не стреляет, пока не ранят). */
  startArm(self: Character, ctx: AiContext, bandit: Character): void {
    this.mode = 'arm';
    this.prey = bandit;
    this.mover.speed = CHARACTER.walkSpeed;
    this.travel.start(self, ctx, this.mover, { x: bandit.x, y: bandit.y });
  }

  /** Взломать камеру КПЗ или клетку (партизан под личиной идёт через люк прямо в Нексус). */
  startJailbreak(self: Character, ctx: AiContext, cell: Cell): void {
    this.mode = 'jailbreak';
    this.cell = cell;
    this.jailWait = 0;
    this.work = 0;
    this.planting = false;
    this.mover.speed = CHARACTER.walkSpeed;
    this.travel.start(self, ctx, this.mover, { x: cell.frontX, y: cell.frontY });
  }

  /** Поставить растяжку в точке. */
  startMine(self: Character, ctx: AiContext, spot: Vec2): void {
    this.mode = 'mine';
    this.spot = spot;
    this.planting = false;
    this.mover.speed = CHARACTER.walkSpeed * PARTISANS.briskWalk;
    this.travel.start(self, ctx, this.mover, spot);
  }

  /** Дело на складе Альянса (через люк и город, в робе грузчика). */
  startDepot(self: Character, ctx: AiContext, act: DepotAct, spot: Vec2): void {
    this.mode = 'depot';
    this.depotAct = act;
    this.spot = spot;
    this.work = 0;
    this.mover.speed = CHARACTER.walkSpeed * PARTISANS.briskWalk;
    this.travel.start(self, ctx, this.mover, spot);
  }

  /** Растяжку ставит — стоит, пока не поставит, потом уходит. true — ещё занят. */
  private plantAndLeave(self: Character, ctx: AiContext): boolean {
    if (!this.planting) {
      this.planting = true;
      if (ctx.combat.startPlant(self)) {
        self.say(ctx.rng.pick(MINE.lines.plant), ctx.combat.now, 1.5);
        this.mover.stop();
        return true;
      }
    } else if (ctx.combat.busy(self)) {
      this.mover.stop();
      return true;
    }
    this.goHome(self, ctx);
    return false;
  }

  private goHome(self: Character, ctx: AiContext): void {
    // Не перезапускать путь каждый тик, если он не находится.
    if (this.mode === 'return' && ctx.combat.now - this.homeAt < 2) return;
    this.homeAt = ctx.combat.now;
    this.fromOuting = this.mode === 'outing';
    this.mode = 'return';
    this.node = null;
    this.prey = null;
    this.cell = null;
    this.spot = null;
    this.planting = false;
    this.mover.speed = CHARACTER.runSpeed * 0.75;
    const base = ctx.insurgency.base;
    if (base) this.travel.start(self, ctx, this.mover, base);
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    if (self.disguised && complyWithCp(self, this.mover, dt)) return;
    // Скрытные дела (ствол бандиту, взлом, растяжка) — огня не открывает, пока не ранят.
    if (this.mode === 'arm' || this.mode === 'jailbreak' || this.mode === 'mine' || this.mode === 'depot') this.gunner.holdFire = ctx.combat.now - self.lastHurt >= INSURGENCY.returnFireFor;
    else if (this.mode !== 'outing' && this.mode !== 'return') this.gunner.holdFire = false;
    const fighting = this.gunner.update(self, ctx, dt);
    // Под личиной ствол в кармане, пока не стреляет.
    if (self.disguised && !this.gunner.target && self.weapon) ctx.combat.equip(self, null);
    const now = ctx.combat.now;
    this.repath -= dt;
    // Раненый — отход (если уже не в убежище).
    if (self.health < self.maxHealth * COMBAT.woundedFraction && this.mode !== 'base' && this.mode !== 'return') this.goHome(self, ctx);

    switch (this.mode) {
      case 'base': {
        if (fighting && this.gunner.target) {
          this.mover.stop();
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
      case 'sabotage': {
        const node = this.node;
        if (!node || node.broken) {
          this.goHome(self, ctx);
          break;
        }
        // Стреляют — отвечает, работа ждёт.
        if (fighting && this.gunner.target) {
          this.mover.stop();
          break;
        }
        const st = this.travel.update(self, ctx, this.mover, dt);
        if (st === 'failed') this.goHome(self, ctx);
        else if (st === 'arrived' || (ctx.map.levelAt(self.x, self.y) === 'city' && Math.hypot(node.x - self.x, node.y - self.y) < 22)) {
          this.travel.stop(this.mover);
          faceTowards(self, node.x, node.y, dt);
          this.work += dt;
          if (this.work >= INSURGENCY.sabotageTime) {
            ctx.economy.sabotage(node, self);
            this.goHome(self, ctx);
          }
        }
        break;
      }
      case 'arm': {
        const b = this.prey;
        const hurt = now - self.lastHurt < INSURGENCY.returnFireFor;
        this.gunner.holdFire = !hurt;
        if (!b || !b.alive || b.law.phase !== 'none' || !ctx.insurgency.armable(b)) {
          this.goHome(self, ctx);
          break;
        }
        const st = this.travel.update(self, ctx, this.mover, dt);
        const up = ctx.map.levelAt(self.x, self.y) === 'city';
        if (up && Math.hypot(b.x - self.x, b.y - self.y) < PARTISANS.arm.reach) {
          this.travel.stop(this.mover);
          ctx.insurgency.armBandit(self, b);
          this.goHome(self, ctx);
        } else if (up && this.repath <= 0 && !this.travel.climbing) {
          // Бандит ходит — цель обновляется.
          this.repath = 2;
          this.travel.start(self, ctx, this.mover, { x: b.x, y: b.y });
        } else if (st === 'failed') this.goHome(self, ctx);
        break;
      }
      case 'jailbreak': {
        // Под личиной огня не открывает, пока не ранят.
        this.gunner.holdFire = now - self.lastHurt >= INSURGENCY.returnFireFor;
        if (this.planting) {
          this.plantAndLeave(self, ctx);
          break;
        }
        // Пока шёл, из камеры выпустили — ломать другую занятую (общая КПЗ почти всегда не пуста).
        if (!this.cell || !this.cell.slots.some((sl) => sl.occupant)) {
          const other = ctx.insurgency.occupiedCell();
          if (!other) {
            // КПЗ пуста — подождать у камер, пока не приведут кого-нибудь (не дольше jailWait с).
            this.work = 0;
            if ((this.jailWait += dt) > PARTISANS.jailWait) this.goHome(self, ctx);
            else if (this.cell && ctx.map.levelAt(self.x, self.y) === 'city' && Math.hypot(this.cell.frontX - self.x, this.cell.frontY - self.y) < 60) this.mover.stop();
            else this.travel.update(self, ctx, this.mover, dt);
            break;
          }
          this.cell = other;
          this.work = 0;
          this.travel.start(self, ctx, this.mover, { x: other.frontX, y: other.frontY });
        }
        const cell = this.cell;
        const st = this.travel.update(self, ctx, this.mover, dt);
        const up = ctx.map.levelAt(self.x, self.y) === 'city';
        if (up && Math.hypot(cell.frontX - self.x, cell.frontY - self.y) < PARTISANS.jailReach) {
          this.travel.stop(this.mover);
          faceTowards(self, cell.x, cell.y, dt);
          this.work += dt;
          if (this.work >= PARTISANS.agent.breakTime) {
            ctx.insurgency.jailbreak(self, cell);
            // Растяжка у двери — прикрыть побег.
            this.plantAndLeave(self, ctx);
          }
        } else if (st === 'failed') this.goHome(self, ctx);
        break;
      }
      case 'mine': {
        this.gunner.holdFire = now - self.lastHurt >= INSURGENCY.returnFireFor;
        if (this.planting) {
          this.plantAndLeave(self, ctx);
          break;
        }
        const to = this.spot;
        if (!to) {
          this.goHome(self, ctx);
          break;
        }
        const st = this.travel.update(self, ctx, this.mover, dt);
        if (ctx.map.levelAt(self.x, self.y) === 'city' && (st === 'arrived' || Math.hypot(to.x - self.x, to.y - self.y) < 22)) {
          this.travel.stop(this.mover);
          this.plantAndLeave(self, ctx);
        } else if (st === 'failed') this.goHome(self, ctx);
        break;
      }
      case 'depot': {
        const to = this.spot;
        const act = this.depotAct;
        if (!to || !act) {
          this.goHome(self, ctx);
          break;
        }
        const st = this.travel.update(self, ctx, this.mover, dt);
        if (ctx.map.levelAt(self.x, self.y) === 'city' && (st === 'arrived' || Math.hypot(to.x - self.x, to.y - self.y) < 24)) {
          this.travel.stop(this.mover);
          faceTowards(self, to.x, to.y, dt);
          this.work += dt;
          if (this.work >= ctx.arsenal.sabotageTime(act)) {
            if (ctx.arsenal.doSabotage(self, act)) ctx.insurgency.radio(DEPOT_DONE[act]);
            this.depotAct = null;
            this.goHome(self, ctx);
          }
        } else if (st === 'failed') this.goHome(self, ctx);
        break;
      }
      case 'outing': {
        // Вылазка скрытная: заметил ГО и по нему не стреляли — не выдаёт себя, уходит вниз.
        const hurt = now - self.lastHurt < INSURGENCY.returnFireFor;
        this.gunner.holdFire = !hurt;
        if (fighting && this.gunner.target && !hurt) {
          this.gunner.holdFire = false;
          this.goHome(self, ctx);
          break;
        }
        if (fighting && this.gunner.target) {
          if (!this.travel.climbing) this.mover.stop();
          break;
        }
        const st = this.travel.update(self, ctx, this.mover, dt);
        if (st === 'failed') this.goHome(self, ctx);
        else if (st === 'arrived') {
          this.outingWait -= dt;
          if (this.outingWait <= 0) this.goHome(self, ctx);
        }
        break;
      }
      case 'return': {
        // Уходит; разведчик с вылазки стреляет, только если по нему попали, остальные — на ходу.
        this.gunner.holdFire = this.fromOuting && now - self.lastHurt >= INSURGENCY.returnFireFor;
        const st = this.travel.update(self, ctx, this.mover, dt);
        if (st === 'arrived' || (st === 'failed' && ctx.map.levelAt(self.x, self.y) === 'sewer')) {
          this.travel.stop(this.mover);
          this.mode = 'base';
          this.mover.speed = CHARACTER.walkSpeed * 0.9;
        } else if (st === 'failed' || st === 'idle') this.goHome(self, ctx);
        break;
      }
    }
    if (!this.travel.climbing) this.mover.update(self, ctx, dt);
    if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
  }

  /** Куда идёт (для отладки). */
  get goal(): Vec2 | null {
    return this.travel.goal;
  }
}
