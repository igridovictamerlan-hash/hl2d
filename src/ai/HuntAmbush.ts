import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Mover } from './Mover';
import type { Gunner } from './Gunner';
import type { HatchTravel } from './HatchTravel';
import type { Vec2 } from '../core/math';
import type { UndergroundGroup } from '../systems/InsurgencySystem';
import { PARTISANS } from '../config/underground';
import { CHARACTER } from '../config/entities';
import { faceTowards } from './facing';
import { canSeeCircle } from '../world/visibility';

/**
 * Охота на патруль ВС (группа подполья task 'hunt': партизаны и спецагенты, союзники — бойцы банд):
 *  сбор — под личиной через люк к своему месту у патрульного (spot), огня не открывают; ведомые держатся
 *    рядом с ведущим; ведущий, когда свои собрались и банды подошли (или ждали PARTISANS.hunt.wait с), идёт
 *    за патрулём быстрым шагом; патрульный ближе engage и на виду — сигнал (InsurgencySystem.groupAttack);
 *  бой — по патрулю, цель далеко — подтянуться к ней; бой дольше fight с — конец (мозг уводит к люку).
 */
export class HuntAmbush {
  private repath = 0;
  private waited = 0;

  constructor(readonly spot: Vec2) {}

  /** Остановили на проверку до сигнала у цели — не сдаётся: сигнал сейчас (обыск нашёл бы автомат). */
  static resist(self: Character, ctx: AiContext, g: UndergroundGroup | null): boolean {
    const ph = self.law.phase;
    if (!g || g.attack || (ph !== 'ordered' && ph !== 'checking') || ctx.map.levelAt(self.x, self.y) !== 'city') return false;
    const p = g.prey;
    if (!p || Math.hypot(p.x - self.x, p.y - self.y) > PARTISANS.hunt.intercept) return false;
    ctx.law.clear(self);
    ctx.insurgency.groupAttack(g, self);
    return true;
  }

  /** Шаг: true — ещё в деле, false — закончил (домой). */
  step(self: Character, ctx: AiContext, g: UndergroundGroup | null, travel: HatchTravel, mover: Mover, gunner: Gunner, dt: number, fighting: boolean): boolean {
    const H = PARTISANS.hunt;
    if (!g || g.alarm) return false;
    const city = ctx.map.levelAt(self.x, self.y) === 'city';
    const now = ctx.insurgency.now;
    this.repath -= dt;
    if (g.attack) {
      if (now - g.firedAt > H.fight) return false;
      mover.speed = CHARACTER.runSpeed * 0.8;
      const t = gunner.target;
      if (fighting && t && Math.hypot(t.x - self.x, t.y - self.y) <= H.engage) {
        travel.stop(mover);
        return true;
      }
      // Цель — патрульный (или ближайший ВС у места боя); никого — ещё немного осмотреться и уходить.
      const prey = ctx.insurgency.huntTarget(g, self);
      if (!prey) return now - g.firedAt < 10;
      if (this.repath <= 0 || mover.status === 'idle' || mover.status === 'failed' || mover.status === 'arrived') {
        this.repath = 1.5;
        travel.start(self, ctx, mover, { x: prey.x, y: prey.y });
      }
      travel.update(self, ctx, mover, dt);
      return true;
    }
    // Затянулось — бросить (патруль ушёл в Управу, не догнать).
    if (now - g.since > H.maxTime) return false;
    const prey = ctx.insurgency.huntTarget(g, self);
    if (!prey) return false;
    const lead = g.lead;
    if (lead !== self) {
      // Ведомые — рядом с ведущим (он и выслеживает патруль); ведущий ещё внизу — к своему месту.
      const leadCity = ctx.map.levelAt(lead.x, lead.y) === 'city';
      const dl = Math.hypot(lead.x - self.x, lead.y - self.y);
      if (city && leadCity && dl < H.huddle * 0.5) {
        travel.stop(mover);
        faceTowards(self, prey.x, prey.y, dt);
      } else {
        if (this.repath <= 0 && !travel.climbing) {
          this.repath = 1.5;
          travel.start(self, ctx, mover, leadCity ? { x: lead.x, y: lead.y } : this.spot);
        }
        if (travel.update(self, ctx, mover, dt) === 'failed' && this.repath <= 0) return false;
      }
      return true;
    }
    const d = Math.hypot(prey.x - self.x, prey.y - self.y);
    const huddle = H.huddle;
    const near = g.members.filter((m) => ctx.map.levelAt(m.x, m.y) === 'city' && Math.hypot(m.x - self.x, m.y - self.y) < huddle).length;
    const assembled = near >= Math.min(2, g.members.length);
    // Бойцы банд, ещё идущие на это дело, подошли.
    const allies = g.allies.every((a) => !a.alive || !a.fit || !ctx.gangs.stormingWith(a, g) || Math.hypot(a.x - self.x, a.y - self.y) < H.allyHuddle);
    if (city && assembled && d < H.engage && canSeeCircle(ctx.map, self.x, self.y, prey.x, prey.y, prey.radius)) {
      ctx.insurgency.groupAttack(g, self);
      return true;
    }
    const at = city && Math.hypot(this.spot.x - self.x, this.spot.y - self.y) < 28;
    if (at) this.waited += dt;
    // Собрались (или ждали долго) — выслеживать патруль быстрым шагом.
    if (city && assembled && (allies || this.waited > H.wait) && !travel.climbing) {
      if (this.repath <= 0 || mover.status === 'idle' || mover.status === 'failed' || mover.status === 'arrived') {
        this.repath = 2;
        travel.start(self, ctx, mover, { x: prey.x, y: prey.y });
      }
      travel.update(self, ctx, mover, dt);
      return true;
    }
    if (at) {
      travel.stop(mover);
      faceTowards(self, prey.x, prey.y, dt);
      return true;
    }
    const st = travel.update(self, ctx, mover, dt);
    if ((st === 'idle' || st === 'failed') && this.repath <= 0) {
      this.repath = 2;
      if (st === 'failed' && !city) return false;
      travel.start(self, ctx, mover, this.spot);
    }
    return true;
  }
}
