import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement } from '../facing';
import { CHARACTER } from '../../config/entities';
import { COMBAT } from '../../config/combat';
import { PARTISANS } from '../../config/underground';

/**
 * Бандит со стволом от партизан — «чужие руки» сопротивления. Ищет патрульного ВС в городе (не на
 * КПП и не в Управе), подходит с оружием в кармане, в PARTISANS.hired.engage px достаёт ствол —
 * с этого момента он враг Протектората (hostile) — и стреляет. Время вышло, ранен или цели нет —
 * прячет оружие и возвращается к прежней жизни (но остаётся в розыске).
 */
export class HiredGunBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed * 1.05);
  readonly gunner: Gunner;
  prey: Character | null = null;
  private readonly until: number;
  private repath = 0;
  /** Сколько раз стрелял (для тестов и отладки). */
  engaged = false;

  constructor(self: Character, ctx: AiContext, private readonly saved: Brain | null) {
    this.gunner = new Gunner(ctx.rng);
    const H = PARTISANS.hired;
    this.until = ctx.combat.now + ctx.rng.range(H.time[0], H.time[1]);
    void self;
  }

  get stateName(): string {
    return this.gunner.target ? 'наёмник · бой' : 'наёмник · ищет ВС';
  }

  /** Бросить дело: оружие в карман, прежний мозг. */
  private finish(self: Character, ctx: AiContext): void {
    ctx.combat.equip(self, null);
    self.hostile = false;
    self.brain = this.saved;
    self.wantX = self.wantY = 0;
  }

  private pickPrey(self: Character, ctx: AiContext): Character | null {
    const H = PARTISANS.hired;
    let best: Character | null = null;
    let bestD: number = H.seek;
    for (const o of ctx.entities.list) {
      if (!o.alive || o.faction !== 'cp' || ctx.map.levelAt(o.x, o.y) !== 'city') continue;
      const k = ctx.map.zoneAtWorld(o.x, o.y)?.kind;
      if (k === 'nexus' || k === 'cells' || k === 'checkpoint' || k === 'outlands' || k === 'wasteland') continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const H = PARTISANS.hired;
    const now = ctx.combat.now;
    if (self.law.phase !== 'none') return;
    if (now > this.until || self.health < self.maxHealth * COMBAT.woundedFraction) {
      this.finish(self, ctx);
      return;
    }
    this.repath -= dt;
    if (!this.prey?.alive || this.repath <= 0) {
      this.prey = this.pickPrey(self, ctx);
      if (!this.prey) {
        this.finish(self, ctx);
        return;
      }
    }
    const prey = this.prey;
    // Вблизи — достать ствол: теперь он враг Протектората (и в розыске).
    if (!self.hostile && Math.hypot(prey.x - self.x, prey.y - self.y) < H.engage) {
      self.hostile = true;
      self.law.wanted = true;
      this.engaged = true;
    }
    const fighting = self.hostile && this.gunner.update(self, ctx, dt);
    if (fighting && this.gunner.target) this.mover.stop();
    else if (this.repath <= 0 || this.mover.status === 'idle' || this.mover.status === 'failed') {
      this.repath = H.repath;
      const a = ctx.nav.nearestWalkable(prey.x, prey.y, 4);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
    this.mover.update(self, ctx, dt);
    if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
  }
}
