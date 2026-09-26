import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { faceMovement } from '../facing';
import { LAW } from '../../config/law';
import { CHARACTER } from '../../config/entities';

/**
 * Гражданин, бегущий к прорванному КПП, чтобы примкнуть к повстанцам. Идёт быстрым шагом (чуть
 * медленнее бега — чтобы ГО не остановил за бег); приказали стоять — стоит, а если решил бежать
 * от ГО — бежит к КПП со всех ног. Дошёл до коридора КПП — WarSystem делает его повстанцем.
 */
export class DefectorBrain implements Brain {
  readonly mover = new Mover(LAW.runSpeed * 0.95);
  private repath = 0;

  constructor(
    readonly front: number,
    ctx: AiContext,
  ) {
    this.repath = ctx.rng.range(0, 0.5);
  }

  get stateName(): string {
    return 'бежит к КПП';
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const phase = self.law.phase;
    if (phase === 'ordered' || phase === 'checking') {
      this.mover.stop();
      this.mover.update(self, ctx, dt);
      return;
    }
    const f = ctx.war.fronts[this.front];
    if (!f) return;
    this.mover.speed = phase === 'fleeing' ? CHARACTER.runSpeed : LAW.runSpeed * 0.95;
    this.repath -= dt;
    const st = this.mover.status;
    if (this.repath <= 0 || st === 'idle' || st === 'failed' || st === 'arrived') {
      this.repath = 5;
      // Цель — внутренняя камера тамбура (между средними и внутренними воротами).
      const x = (f.midGate.x + f.innerGate.x) / 2;
      const y = (f.midGate.y + f.innerGate.y) / 2;
      const a = ctx.nav.nearestWalkable(x, y, 4);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
    this.mover.update(self, ctx, dt);
    faceMovement(self, ctx, dt);
  }
}
