import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { CrimeScene } from '../../systems/CrimeScenes';
import { Mover } from '../Mover';
import { faceMovement, faceTowards } from '../facing';
import { CHARACTER } from '../../config/entities';
import { CRIME } from '../../config/crime';

/**
 * Медик ГСР на месте происшествия (когда медики SU.02 заняты — CrimeScenes.sendMedic): идёт к телу,
 * на корточках с планшетом осматривает его CRIME.scene.examTime с, накрывает мешком и возвращается к
 * своей работе (прежний мозг). Оцепление сняли, тело увезли, его задержали — бросает дело.
 */
export class ExamineBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed * CRIME.scene.speed);
  private left: number = CRIME.scene.examTime;
  private arrived = false;
  private repath = 0;

  constructor(readonly scene: CrimeScene, private readonly saved: Brain | null) {}

  get stateName(): string {
    return this.arrived ? 'осмотр тела' : 'к месту происшествия';
  }

  /** Вернуться к прежней жизни. */
  finish(self: Character): void {
    self.notepadUntil = 0;
    self.brain = this.saved;
    self.wantX = self.wantY = 0;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const s = this.scene;
    const S = CRIME.scene;
    if (s.closed || s.examinedAt >= 0 || !ctx.combat.corpses.includes(s.corpse) || self.law.phase !== 'none') {
      this.finish(self);
      return;
    }
    const c = s.corpse;
    if (Math.hypot(c.x - self.x, c.y - self.y) > S.examReach) {
      this.repath -= dt;
      const st = this.mover.status;
      if (this.repath <= 0 || st === 'idle' || st === 'failed') {
        this.repath = 2;
        const a = ctx.nav.nearestWalkable(c.x, c.y, 2);
        if (a >= 0) this.mover.goTo(self, ctx, a);
      }
      this.mover.update(self, ctx, dt);
      faceMovement(self, ctx, dt);
      return;
    }
    this.mover.stop();
    this.mover.update(self, ctx, dt);
    faceTowards(self, c.x, c.y, dt);
    if (!this.arrived) {
      this.arrived = true;
      self.say(ctx.rng.pick(S.lines.cwuMedic), ctx.law.now, 2.5);
    }
    self.notepadUntil = ctx.combat.now + 0.3;
    if (ctx.rng.chance(dt * 0.25)) self.say(ctx.rng.pick(S.lines.examine), ctx.law.now, 2.5);
    if ((this.left -= dt) <= 0) {
      ctx.war.scenes.examined(s);
      self.say(ctx.rng.pick(S.lines.cover), ctx.law.now, 2.5);
      this.finish(self);
    }
  }
}
