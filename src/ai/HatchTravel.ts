import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Mover } from './Mover';
import type { Vec2 } from '../core/math';
import type { HatchUse } from '../systems/UndergroundSystem';
import { UNDERGROUND } from '../config/underground';

export type TravelStatus = 'idle' | 'moving' | 'climbing' | 'arrived' | 'failed';

/**
 * Путь NPC с учётом люков: цель на другом уровне — сначала к люку, UNDERGROUND.climbTime секунд
 * лезет, появляется у парного люка и идёт дальше. На одном уровне — обычный путь Mover.
 */
export class HatchTravel {
  goal: Vec2 | null = null;
  status: TravelStatus = 'idle';
  private via: HatchUse | null = null;
  private climbLeft = 0;
  private retries = 0;

  start(self: Character, ctx: AiContext, mover: Mover, goal: Vec2): void {
    this.goal = goal;
    this.via = ctx.underground.route(self, goal);
    this.climbLeft = 0;
    this.retries = 0;
    this.status = 'moving';
    this.leg(self, ctx, mover);
  }

  stop(mover: Mover): void {
    this.status = 'idle';
    this.goal = null;
    this.via = null;
    mover.stop();
  }

  /** Идёт ли сейчас подъём/спуск по люку. */
  get climbing(): boolean {
    return this.climbLeft > 0;
  }

  private leg(self: Character, ctx: AiContext, mover: Mover): void {
    const target = this.via ? this.via.from : this.goal;
    if (!target) return;
    const a = ctx.nav.nearestWalkable(target.x, target.y, 4);
    if (a < 0) {
      this.status = 'failed';
      return;
    }
    mover.goTo(self, ctx, a);
  }

  update(self: Character, ctx: AiContext, mover: Mover, dt: number): TravelStatus {
    if (this.status !== 'moving' && this.status !== 'climbing') return this.status;
    if (this.climbLeft > 0) {
      this.climbLeft -= dt;
      self.wantX = self.wantY = 0;
      if (this.climbLeft <= 0 && this.via) {
        ctx.underground.climb(self, this.via.to);
        this.via = null;
        mover.stop();
        this.status = 'moving';
        this.leg(self, ctx, mover);
      }
      return this.status;
    }
    if (this.via) {
      if (Math.hypot(this.via.from.x - self.x, this.via.from.y - self.y) < UNDERGROUND.useRadius) {
        mover.stop();
        this.climbLeft = UNDERGROUND.climbTime;
        this.status = 'climbing';
        return this.status;
      }
    } else if (this.goal && (mover.status === 'arrived' || Math.hypot(this.goal.x - self.x, this.goal.y - self.y) < 20)) {
      mover.stop();
      this.status = 'arrived';
      return this.status;
    }
    if (mover.status === 'failed' || mover.status === 'idle' || mover.status === 'arrived') {
      if (++this.retries > 4) this.status = 'failed';
      else this.leg(self, ctx, mover);
    }
    return this.status;
  }
}
