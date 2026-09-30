import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, faceTowards } from '../facing';
import { CHARACTER } from '../../config/entities';
import { PRISON } from '../../config/prison';

/**
 * Освобождённый из камеры тюрьмы вооружается, прежде чем уйти: бегом в оружейную (дверь заперта —
 * выбивает), берёт ствол со стойки, магазины и гранату; если комната изъятого по пути (не дальше
 * armory.detour px) или оружейная пуста — забирает своё изъятое. Вооружился и видит врага, вышло время
 * (armory.arm с) или брать нечего — прежний мозг и then (куда ему дальше решает подполье или армия).
 */
export class ArmingBrain implements Brain {
  readonly mover = new Mover(CHARACTER.runSpeed);
  readonly gunner: Gunner;
  private step: 'armory' | 'evidence' = 'armory';
  private readonly until: number;
  private breaking = 0;
  private repath = 0;
  private goal: Vec2 | null = null;
  private said = false;

  constructor(ctx: AiContext, private readonly saved: Brain | null, private readonly then: () => void) {
    this.gunner = new Gunner(ctx.rng);
    this.until = ctx.combat.now + PRISON.armory.arm;
  }

  get stateName(): string {
    if (this.breaking > 0) return 'побег · выбивает оружейную';
    return this.step === 'armory' ? 'побег · в оружейную' : 'побег · за изъятым';
  }

  private finish(self: Character): void {
    self.brain = this.saved;
    self.wantX = self.wantY = 0;
    this.then();
  }

  private go(self: Character, ctx: AiContext, to: Vec2, dt: number): void {
    this.repath -= dt;
    const st = this.mover.status;
    if (this.goal !== to || this.repath <= 0 || st === 'idle' || st === 'failed') {
      this.goal = to;
      this.repath = 2;
      const a = ctx.nav.nearestWalkable(to.x, to.y, 2);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    if (self.law.phase !== 'none') return;
    const P = ctx.prison;
    const A = PRISON.armory;
    if (!self.fit) {
      this.mover.stop();
      this.mover.update(self, ctx, dt);
      return;
    }
    const armed = ctx.combat.weaponsOf(self).some((id) => id !== 'knife' && id !== 'stunstick');
    // Вооружён и враг на виду — дальше воюет прежний мозг.
    if (ctx.combat.now > this.until || (armed && this.gunner.acquire(self, ctx))) return this.finish(self);
    const near = (p: Vec2, r: number) => Math.hypot(p.x - self.x, p.y - self.y) < r;
    const own = ctx.law.evidence.has(self) && !!P.evidenceSpot;
    if (this.step === 'armory') {
      const spot = P.armorySpot;
      if (!spot || P.stock.guns <= 0 || armed) {
        if (own) this.step = 'evidence';
        else return this.finish(self);
      } else if (P.armoryLocked && P.armoryFront && !P.inArmory(self.x, self.y)) {
        // Заперто — к двери и выбивать.
        const front = P.armoryFront;
        if (!near(front, A.reach)) {
          this.breaking = 0;
          this.go(self, ctx, front, dt);
        } else {
          this.mover.stop();
          const d = P.armoryDoorTiles[0] ?? front;
          faceTowards(self, d.x, d.y, dt);
          if (this.breaking === 0) self.say(ctx.rng.pick(PRISON.lines.armoryBreak), ctx.law.now, 2);
          this.breaking += dt;
          if (this.breaking >= A.breakTime) {
            this.breaking = 0;
            P.breakArmory(self);
          }
        }
      } else if (!near(spot, A.useReach)) {
        this.breaking = 0;
        this.go(self, ctx, spot, dt);
      } else {
        this.mover.stop();
        const got = P.takeArms(self);
        if (got && !this.said) {
          this.said = true;
          self.say(ctx.rng.pick(PRISON.lines.armory), ctx.law.now, 2);
        }
        if (!got && !own) return this.finish(self);
        // Своё изъятое — если по пути (или ничего не досталось).
        const ev = P.evidenceSpot;
        if (own && ev && (!got || Math.hypot(ev.x - spot.x, ev.y - spot.y) < A.detour)) this.step = 'evidence';
        else return this.finish(self);
      }
    }
    if (this.step === 'evidence') {
      const ev = P.evidenceSpot;
      if (!ev || !ctx.law.evidence.has(self)) return this.finish(self);
      if (!near(ev, A.useReach)) this.go(self, ctx, ev, dt);
      else {
        P.takeEvidence(self);
        self.say(ctx.rng.pick(PRISON.lines.evidence), ctx.law.now, 2);
        return this.finish(self);
      }
    }
    this.mover.update(self, ctx, dt);
    faceMovement(self, ctx, dt);
  }
}
