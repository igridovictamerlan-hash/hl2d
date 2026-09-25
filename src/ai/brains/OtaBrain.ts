import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorAround } from '../destinations';
import { poiWorld } from '../../systems/Population';

/**
 * Солдат OTA: выходит из Нексуса при красном коде, идёт к последней известной позиции
 * прорвавшихся, стреляет на поражение. По отбою возвращается в Нексус и уходит.
 */
export class OtaBrain implements Brain {
  readonly mover = new Mover(95);
  readonly gunner: Gunner;
  /** Вернулся в Нексус после отбоя — WarSystem уберёт. */
  departed = false;
  private home = false;
  private repath = 0;

  constructor(_self: Character, ctx: AiContext) {
    this.gunner = new Gunner(ctx.rng);
  }

  get stateName(): string {
    return this.home ? 'возврат' : this.gunner.target ? 'бой' : 'охота';
  }

  goHome(): void {
    this.home = true;
    this.repath = 0;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const fighting = this.gunner.update(self, ctx, dt);
    this.repath -= dt;
    if (fighting && this.gunner.target) {
      ctx.war.sighted(this.gunner.target);
      this.mover.stop();
    } else if (this.home) {
      if (this.repath <= 0) {
        this.repath = 3;
        const g = poiWorld(ctx, 'nexus_gate');
        if (g) this.mover.goTo(self, ctx, ctx.nav.nearestWalkable(g.x, g.y, 6));
      }
      if (this.mover.status === 'arrived' || this.mover.status === 'failed') this.departed = true;
    } else if (this.repath <= 0 || this.mover.status === 'arrived' || this.mover.status === 'failed') {
      this.repath = 3;
      const p = ctx.war.nearestKnown(self.x, self.y);
      const a = p ? ctx.nav.nearestWalkable(p.x, p.y, 6) : randomAnchorAround(self, ctx, 10, 40, new Set());
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
    this.mover.update(self, ctx, dt);
    if (this.gunner.target?.alive) faceTowards(self, this.gunner.target.x, this.gunner.target.y, dt);
    else faceMovement(self, ctx, dt);
  }
}
