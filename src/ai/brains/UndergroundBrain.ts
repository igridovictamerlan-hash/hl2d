import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import type { RepairSpot } from '../../systems/EconomySystem';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { HatchTravel } from '../HatchTravel';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorInZone } from '../destinations';
import { COMBAT } from '../../config/combat';
import { CHARACTER } from '../../config/entities';
import { INSURGENCY } from '../../config/underground';

export type OpMode = 'base' | 'sabotage' | 'ambush' | 'return' | 'outing';

/**
 * Боец убежища сопротивления в канализации.
 *  base — бродит по убежищу, защищает его;
 *  sabotage — через люк к узлу Альянса, возится INSURGENCY.sabotageTime с, уходит;
 *  ambush — через люк к патрулю ГО, бой INSURGENCY.ambushFight с, отход;
 *  return — к ближайшему люку и вниз, в убежище (раненый — сразу сюда).
 */
export class UndergroundBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed * 0.9);
  readonly gunner: Gunner;
  readonly travel = new HatchTravel();
  mode: OpMode = 'base';
  /** Цель операции: узел или сотрудник ГО. */
  node: RepairSpot | null = null;
  prey: Character | null = null;
  private work = 0;
  private fightUntil = 0;
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

  startAmbush(self: Character, ctx: AiContext, prey: Character): void {
    this.mode = 'ambush';
    this.prey = prey;
    this.fightUntil = 0;
    this.mover.speed = CHARACTER.walkSpeed * 1.1;
    this.travel.start(self, ctx, this.mover, { x: prey.x, y: prey.y });
  }

  private goHome(self: Character, ctx: AiContext): void {
    // Не перезапускать путь каждый тик, если он не находится.
    if (this.mode === 'return' && ctx.combat.now - this.homeAt < 2) return;
    this.homeAt = ctx.combat.now;
    this.fromOuting = this.mode === 'outing';
    this.mode = 'return';
    this.node = null;
    this.prey = null;
    this.mover.speed = CHARACTER.runSpeed * 0.75;
    const base = ctx.insurgency.base;
    if (base) this.travel.start(self, ctx, this.mover, base);
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    if (this.mode !== 'outing' && this.mode !== 'return') this.gunner.holdFire = false;
    const fighting = this.gunner.update(self, ctx, dt);
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
      case 'ambush': {
        const prey = this.prey;
        if (fighting && this.gunner.target) {
          if (this.fightUntil === 0) this.fightUntil = now + ctx.rng.range(INSURGENCY.ambushFight[0], INSURGENCY.ambushFight[1]);
          if (!this.travel.climbing) this.mover.stop();
        } else {
          const st = this.travel.update(self, ctx, this.mover, dt);
          // Поднялись в город: идём на патрульного (он ходит — цель обновляется).
          if (prey?.alive && ctx.map.levelAt(self.x, self.y) === 'city' && this.repath <= 0 && !this.travel.climbing) {
            this.repath = 2;
            this.travel.start(self, ctx, this.mover, { x: prey.x, y: prey.y });
          }
          if (st === 'failed' || (!prey?.alive && this.fightUntil === 0 && ctx.map.levelAt(self.x, self.y) === 'city')) this.goHome(self, ctx);
        }
        if (this.fightUntil > 0 && (now > this.fightUntil || (!fighting && !prey?.alive))) this.goHome(self, ctx);
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
