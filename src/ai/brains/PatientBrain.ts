/** Описание системы — docs/hospital.md. */
import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Bed, HospitalSystem } from '../../systems/Hospital';
import { Mover } from '../Mover';
import { faceMovement } from '../facing';
import { CHARACTER } from '../../config/entities';
import { HOSPITAL } from '../../config/hospital';

/**
 * Больной в больнице (временный мозг поверх прежнего; HospitalSystem.lay): лежит на своей койке (или носилках),
 * лечится HOSPITAL.care.perSec HP/с; вылечился (не меньше discharge доли) и пролежал minStay с — выписка
 * (HospitalSystem.discharge). Сам пришёл (walkIn) — сперва доходит до койки. Под охраной (преступник) — ждёт,
 * пока конвоир не заберёт (CustodyBrain). Ранили на койке — вскакивает (прежний мозг: бой или бегство).
 */
export class PatientBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed);
  private admitted = -1;
  private hurtAt = 0;
  private lineAt = 0;
  private repath = 0;

  constructor(private readonly hospital: HospitalSystem, readonly bed: Bed, readonly saved: Brain | null, readonly custody: boolean, private walkIn: boolean) {}

  get stateName(): string {
    return this.walkIn ? 'идёт к койке' : this.custody ? 'в больнице · под охраной' : 'в больнице';
  }

  /** Здоров для выписки. */
  ready(self: Character, now: number): boolean {
    return this.admitted >= 0 && !this.walkIn && self.health >= self.maxHealth * HOSPITAL.care.discharge && now - this.admitted >= HOSPITAL.care.minStay;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const C = HOSPITAL.care;
    const now = ctx.combat.now;
    if (this.admitted < 0) {
      this.admitted = now;
      this.hurtAt = self.lastHurt;
      this.lineAt = now + ctx.rng.range(8, 20);
    }
    // Ранили в больнице — с койки и прочь (прежний мозг решит: бой или бегство).
    if (self.lastHurt > this.hurtAt) {
      this.hospital.discharge(self, this, true);
      return;
    }
    const s = this.bed.spot;
    if (this.walkIn) {
      if (Math.hypot(s.x - self.x, s.y - self.y) > 10) {
        this.repath -= dt;
        const st = this.mover.status;
        if (this.repath <= 0 || st === 'idle' || st === 'failed' || st === 'arrived') {
          this.repath = 2;
          const a = ctx.nav.nearestWalkable(s.x, s.y, 2);
          if (a >= 0) this.mover.goTo(self, ctx, a);
        }
        this.mover.update(self, ctx, dt);
        faceMovement(self, ctx, dt);
        // Не дошёл — всё равно ложится там, где стоит (врачи примут).
        if (now - this.admitted < 60) return;
      }
      this.walkIn = false;
      this.admitted = now;
    }
    this.mover.stop();
    this.mover.update(self, ctx, dt);
    self.wantX = self.wantY = 0;
    self.ghost = 1;
    self.inBed = true;
    self.asleep = !!this.bed.box;
    self.sleepAt = this.bed.box;
    self.bleed = 0;
    if (self.health < self.maxHealth) self.health = Math.min(self.maxHealth, self.health + C.perSec * dt);
    if (now >= this.lineAt) {
      this.lineAt = now + ctx.rng.range(25, 60);
      self.say(ctx.rng.pick(HOSPITAL.lines.patient), ctx.law.now, 2.5);
    }
    if (!this.custody && this.ready(self, now)) this.hospital.discharge(self, this);
  }
}
