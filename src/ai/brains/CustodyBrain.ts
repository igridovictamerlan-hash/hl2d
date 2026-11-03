/** Описание системы — docs/hospital.md. */
import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { HospitalSystem } from '../../systems/Hospital';
import { Mover } from '../Mover';
import { faceMovement, faceTowards } from '../facing';
import { HOSPITAL } from '../../config/hospital';
import { LAW } from '../../config/law';
import { PatientBrain } from './PatientBrain';

/**
 * Юнит ВС за преступником в больницу (временный мозг поверх CpBrain; HospitalSystem.custodyTick): идёт к койке,
 * стоит рядом и ждёт выписки; выписали — задерживает (HospitalSystem.handOver) и ведёт в тюрьму или КПЗ (escort
 * прежнего мозга). Не дошёл за HOSPITAL.custody.giveUp с, ранили, больной исчез — бросает (пошлют другого).
 */
export class CustodyBrain implements Brain {
  readonly mover = new Mover(LAW.cpWalkSpeed * 1.3);
  private started = -1;
  private hurtAt = 0;
  private arrived = false;
  private repath = 0;

  constructor(private readonly hospital: HospitalSystem, readonly patient: Character, readonly saved: Brain | null) {}

  get stateName(): string {
    return this.arrived ? 'охраняет задержанного в больнице' : 'в больницу за задержанным';
  }

  private finish(self: Character): void {
    this.hospital.custodyReleased(this.patient, self);
    if (self.brain === this) self.brain = this.saved;
    self.wantX = self.wantY = 0;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const K = HOSPITAL.custody;
    const p = this.patient;
    const pb = p.brain;
    const now = ctx.combat.now;
    if (this.started < 0) {
      this.started = now;
      this.hurtAt = self.lastHurt;
    }
    if (!p.alive || !(pb instanceof PatientBrain) || !self.fit || self.lastHurt > this.hurtAt || (!this.arrived && now - this.started > K.giveUp)) {
      this.finish(self);
      return;
    }
    const s = pb.bed.spot;
    const d = Math.hypot(s.x - self.x, s.y - self.y);
    if (d > K.reach) {
      this.repath -= dt;
      const st = this.mover.status;
      if (this.repath <= 0 || st === 'idle' || st === 'failed' || st === 'arrived') {
        this.repath = 2;
        const a = ctx.nav.nearestWalkable(s.x, s.y, 3);
        if (a >= 0) this.mover.goTo(self, ctx, a);
      }
      this.mover.update(self, ctx, dt);
      faceMovement(self, ctx, dt);
      return;
    }
    this.mover.stop();
    this.mover.update(self, ctx, dt);
    faceTowards(self, p.x, p.y, dt);
    if (!this.arrived) {
      this.arrived = true;
      self.say(ctx.rng.pick(HOSPITAL.lines.custody), ctx.law.now, 2.5);
    }
    if (pb.ready(p, now)) {
      if (self.brain === this) this.hospital.handOver(p, pb, self, this.saved);
    }
  }
}
