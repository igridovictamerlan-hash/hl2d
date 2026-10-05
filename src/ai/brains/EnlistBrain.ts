import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { faceMovement, faceTowards } from '../facing';
import { CHARACTER } from '../../config/entities';
import { ACADEMY } from '../../config/academy';

/**
 * Лоялист с направлением в академию (AcademySystem.recruit): идёт на вахту академии, у стойки дежурного
 * оформляется ACADEMY.recruit.applyTime с — и его зачисляют курсантом. Не дошёл до срока, задержали, красный
 * код — направление пропало, прежняя жизнь (прежний мозг).
 */
export class EnlistBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed);
  private left: number = ACADEMY.recruit.applyTime;
  private arrived = false;
  private repath = 0;

  constructor(
    private readonly saved: Brain | null,
    private readonly until: number,
  ) {}

  get stateName(): string {
    return this.arrived ? 'оформляется в академию' : 'идёт в академию';
  }

  private finish(self: Character, ctx: AiContext): void {
    ctx.academy?.applicants.delete(self);
    self.brain = this.saved;
    self.wantX = self.wantY = 0;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const A = ctx.academy;
    const p = A?.applyAt;
    if (!A?.present || !p || self.law.phase !== 'none' || ctx.law.now > this.until || ctx.war.code === 'red' || self.faction !== 'citizen') {
      this.finish(self, ctx);
      return;
    }
    if (Math.hypot(p.x - self.x, p.y - self.y) > 18) {
      this.repath -= dt;
      const st = this.mover.status;
      if (this.repath <= 0 || st === 'idle' || st === 'failed') {
        this.repath = 3;
        const a = ctx.nav.nearestWalkable(p.x, p.y, 2);
        if (a >= 0) this.mover.goTo(self, ctx, a);
      }
      this.mover.update(self, ctx, dt);
      faceMovement(self, ctx, dt);
      return;
    }
    this.mover.stop();
    this.mover.update(self, ctx, dt);
    const c = A.counter;
    if (c) faceTowards(self, c.x, c.y, dt);
    if (!this.arrived) {
      this.arrived = true;
      self.say(ctx.rng.pick(ACADEMY.lines.applicant), ctx.law.now, 2.5);
    }
    this.left -= dt;
    if (this.left <= 0) A.enroll(self);
  }
}
