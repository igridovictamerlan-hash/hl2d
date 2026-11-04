/** Описание системы — docs/hospital.md. */
import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Bed, Evac, HospitalSystem } from '../../systems/Hospital';
import { Mover } from '../Mover';
import { faceMovement, faceTowards } from '../facing';
import { CHARACTER } from '../../config/entities';
import { HOSPITAL } from '../../config/hospital';
import { DOWNED } from '../../config/tactics';

type Phase = 'go' | 'wait' | 'stabilize' | 'carry';

const NAMES: Record<Phase, string> = { go: 'к раненому', wait: 'ждёт, пока стихнет', stabilize: 'стабилизирует', carry: 'несёт в больницу' };

/**
 * Медик на вызове к тяжелораненому (временный мозг поверх прежнего; HospitalSystem.dispatch): бегом к лежащему,
 * там «горячо» (враг на виду, стрельба) — ждёт в standoff px; рядом — стабилизирует (кровь остановлена) и несёт на
 * носилках в больницу на свободную койку; принял — к прежней жизни. Ранили, лежащего подняли или он умер, не
 * успел за giveUp с — бросает дело (лежащего возьмёт другой).
 */
export class EvacBrain implements Brain {
  readonly mover = new Mover(CHARACTER.runSpeed * HOSPITAL.evac.run);
  phase: Phase = 'go';
  private t = 0;
  private repath = 0;
  private started = -1;
  private hurtAt = 0;
  private saidWait = false;
  private bed: Bed | null = null;
  /** Подряд не построился путь (заперто, отрезано). */
  private fails = 0;

  constructor(private readonly hospital: HospitalSystem, readonly evac: Evac, readonly saved: Brain | null) {}

  get stateName(): string {
    return `медик · ${NAMES[this.phase]}`;
  }

  /** Вернуться к прежней жизни (носилки — на землю, если ещё несёт); noPath — не нашёл пути к лежащему. */
  finish(self: Character, ctx: AiContext, noPath = false): void {
    if (self.dragging) ctx.combat.stopDrag(self);
    self.task = '';
    this.hospital.released(this.evac, self, noPath);
    if (self.brain === this) self.brain = this.saved;
    self.wantX = self.wantY = 0;
  }

  private goTo(self: Character, ctx: AiContext, x: number, y: number, dt: number): void {
    this.repath -= dt;
    const st = this.mover.status;
    if (st === 'failed') this.fails++;
    else if (st === 'moving') this.fails = 0;
    if (this.repath <= 0 || st === 'idle' || st === 'failed' || st === 'arrived') {
      this.repath = 1.2;
      const a = ctx.nav.nearestWalkable(x, y, 2);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const E = HOSPITAL.evac;
    const p = this.evac.patient;
    const now = ctx.combat.now;
    if (this.started < 0) {
      this.started = now;
      this.hurtAt = self.lastHurt;
    }
    if (!p.alive || !p.downed || !self.fit || self.law.phase !== 'none' || this.hospital.evacs.get(p) !== this.evac || now - this.started > E.giveUp || self.lastHurt > this.hurtAt) {
      this.finish(self, ctx);
      return;
    }
    // Пути к лежащему (или к больнице) нет — бросить вызов.
    if (this.fails >= E.pathFails) {
      this.finish(self, ctx, this.phase !== 'carry');
      return;
    }
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    const reach = E.reach + self.radius;
    switch (this.phase) {
      case 'go':
      case 'wait': {
        // Под огнём к лежащему не лезет — ждёт поодаль, пока не стихнет.
        if (d < E.standoff && d > reach && this.hospital.hot(p, self)) {
          if (this.phase !== 'wait') {
            this.phase = 'wait';
            this.hospital.stats.waited++;
          }
          this.mover.stop();
          faceTowards(self, p.x, p.y, dt);
          if (!this.saidWait) {
            this.saidWait = true;
            self.say(ctx.rng.pick(HOSPITAL.lines.wait), ctx.law.now, 2.5);
          }
          break;
        }
        this.phase = 'go';
        if (d <= reach) {
          this.mover.stop();
          this.phase = 'stabilize';
          this.t = 0;
          self.say(ctx.rng.pick(HOSPITAL.lines.stabilize), ctx.law.now, 2.5);
          break;
        }
        this.mover.speed = CHARACTER.runSpeed * E.run;
        this.goTo(self, ctx, p.x, p.y, dt);
        break;
      }
      case 'stabilize': {
        this.mover.stop();
        self.task = 'crouch';
        faceTowards(self, p.x, p.y, dt);
        if (d > reach + 10) {
          this.phase = 'go';
          self.task = '';
          break;
        }
        this.t += dt;
        if (this.t < E.stabilize) break;
        self.task = '';
        if (!p.evacStable) this.hospital.stats.stabilized++;
        p.evacStable = true;
        p.bleed = 0;
        p.downedUntil = now + E.carryHold;
        p.downedSpan = p.downedUntil - p.downedAt;
        this.bed = this.hospital.reserveBed(p);
        ctx.combat.stopDrag(p);
        // Носилки — в любом случае: не дотянулся (стабилизирует с reach + 10, а взять — с DOWNED.reach) — подойдёт
        // вплотную и возьмёт (carry). Раньше здесь оставался в stabilize и каждый тик стабилизировал заново до giveUp.
        ctx.combat.startDrag(self, p);
        this.phase = 'carry';
        this.repath = 0;
        self.say(ctx.rng.pick(HOSPITAL.lines.carry), ctx.law.now, 2.5);
        break;
      }
      case 'carry': {
        // Носилки выскользнули (затор, угол) — подойти и взять снова.
        if (self.dragging !== p) {
          if (d <= DOWNED.reach + self.radius) {
            this.mover.stop();
            if (!ctx.combat.startDrag(self, p)) break;
          } else {
            this.goTo(self, ctx, p.x, p.y, dt);
            break;
          }
        }
        if (!this.bed) this.bed = this.hospital.reserveBed(p);
        const to = this.bed?.spot ?? this.hospital.door;
        if (!to) {
          this.finish(self, ctx);
          return;
        }
        if (Math.hypot(to.x - self.x, to.y - self.y) < 20 || (!this.bed && Math.hypot(to.x - self.x, to.y - self.y) < HOSPITAL.care.door)) {
          this.mover.stop();
          this.hospital.admit(p, this.bed, self);
          this.finish(self, ctx);
          return;
        }
        this.mover.speed = CHARACTER.runSpeed * E.run;
        this.goTo(self, ctx, to.x, to.y, dt);
        break;
      }
    }
    this.mover.update(self, ctx, dt);
    if (this.phase !== 'stabilize' && this.phase !== 'wait') faceMovement(self, ctx, dt);
  }
}
