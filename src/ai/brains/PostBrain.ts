import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { turnTowards } from '../facing';
import type { Vec2 } from '../../core/math';

/** Стоит на своём месте (Администратор в кабинете Нексуса). Отошёл/толкнули — возвращается. */
export class PostBrain implements Brain {
  readonly mover = new Mover(70);
  stateName = 'на посту';
  private retry = 0;

  constructor(
    readonly post: Vec2,
    readonly facing = 0,
  ) {}

  update(self: Character, ctx: AiContext, dt: number): void {
    const d = Math.hypot(self.x - this.post.x, self.y - this.post.y);
    this.retry -= dt;
    if (d > 14 && this.mover.status !== 'moving' && this.mover.status !== 'pending' && this.retry <= 0) {
      this.retry = 2;
      const a = ctx.nav.nearestWalkable(this.post.x, this.post.y, 3);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
    if (this.mover.status === 'arrived') this.mover.stop();
    this.mover.update(self, ctx, dt);
    if (self.moveSpeed < 5) turnTowards(self, this.facing, dt, 2);
    else turnTowards(self, Math.atan2(self.vy, self.vx), dt);
  }
}
