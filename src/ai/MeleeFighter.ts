import type { Character } from '../entities/Character';
import type { MeleeAttack } from '../entities/meleeState';
import type { AiContext } from './AiContext';
import type { Mover } from './Mover';
import { MELEE } from '../config/melee';
import { faceTowards } from './facing';

type Mode = 'circle' | 'press' | 'back' | 'guard';

/** Смотрит ли a на b (b в секторе ±60° взгляда a). */
function facingTo(a: Character, b: Character): boolean {
  let d = Math.atan2(b.y - a.y, b.x - a.x) - a.facing;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < Math.PI / 3;
}

/**
 * Боец в драке (config/melee MELEE.ai): не стоит столбом и не машет без конца — держится чуть дальше
 * удара и обходит противника по кругу, заходит серией и отходит; видит замах противника — закрывается,
 * отшагивает или бьёт навстречу (быстрый удар сбивает медленный замах). Шаги — Mover.drive, удары и
 * блок — Melee. Бандиты злее: закрываются реже, серии длиннее.
 */
export class MeleeFighter {
  private mode: Mode = 'circle';
  private until = 0;
  private strikes = 0;
  private dir: 1 | -1 = 1;
  private seen: MeleeAttack | null = null;
  private stuck = 0;

  constructor(private readonly self: Character) {}

  /** Тик боя против o (ближе MELEE.ai.engage): шаг, блок, удары; walk — скорость шага бойца. */
  tick(o: Character, ctx: AiContext, mover: Mover, walk: number, dt: number): void {
    const { self } = this;
    const A = MELEE.ai;
    const melee = ctx.combat.melee;
    const rng = ctx.rng;
    const now = ctx.combat.now;
    const m = self.melee;
    m.stance = Math.max(m.stance, now + 0.5);
    faceTowards(self, o.x, o.y, dt);
    // Сбит или вырубили — стоит, пока не придёт в себя.
    if (m.ko > now || m.stagger > now) {
      melee.guard(self, false);
      mover.stop();
      return;
    }
    const P = self.gang >= 0 || self.profession === 'bandit' ? A.bandit : A;
    const dx = o.x - self.x;
    const dy = o.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const reach = melee.reachOf(self);
    // Противник замахнулся на меня — закрыться, отшагнуть или ударить навстречу.
    const oa = o.melee.attack;
    if (oa && !oa.done && oa !== this.seen && d < melee.reachOf(o) + 14 && facingTo(o, self)) {
      this.seen = oa;
      const r = rng.next();
      if (r < P.block) {
        this.mode = 'guard';
        this.until = now + rng.range(A.guard[0], A.guard[1]);
      } else if (r < P.block + P.dodge) {
        this.mode = 'back';
        this.until = now + A.back[0];
      } else if (d <= reach && melee.ready(self)) melee.start(self, o.x, o.y);
    }
    let vx = 0;
    let vy = 0;
    switch (this.mode) {
      case 'guard':
        // Закрылся — потихоньку пятится; опустил — снова в дело.
        melee.guard(self, true);
        vx = -ux * walk * 0.3;
        vy = -uy * walk * 0.3;
        if (now >= this.until) {
          melee.guard(self, false);
          this.mode = rng.chance(0.6) ? 'press' : 'circle';
          this.strikes = rng.int(P.combo[0], P.combo[1]);
          this.until = now + (this.mode === 'press' ? 2.5 : rng.range(A.wait[0], A.wait[1]));
        }
        break;
      case 'back':
        melee.guard(self, false);
        vx = (-ux - uy * this.dir * 0.4) * walk * A.backSpeed;
        vy = (-uy + ux * this.dir * 0.4) * walk * A.backSpeed;
        if (now >= this.until) {
          this.mode = 'circle';
          this.until = now + rng.range(A.wait[0], A.wait[1]);
        }
        break;
      case 'circle': {
        // По кругу, держа дистанцию чуть дальше удара; сторону обхода меняет.
        melee.guard(self, false);
        const radial = Math.max(-1, Math.min(1, (d - reach - A.band) / 12));
        vx = (-uy * this.dir * A.circle + ux * radial * 0.8) * walk;
        vy = (ux * this.dir * A.circle + uy * radial * 0.8) * walk;
        if (rng.chance(dt / A.turn)) this.dir = this.dir === 1 ? -1 : 1;
        if (now >= this.until) {
          this.mode = 'press';
          this.strikes = rng.int(P.combo[0], P.combo[1]);
          this.until = now + 2.5;
        }
        break;
      }
      case 'press':
        // Заход: вплотную — серия, потом отход.
        melee.guard(self, false);
        if (d > reach - 2) {
          vx = ux * walk * A.press;
          vy = uy * walk * A.press;
        }
        if (this.strikes > 0 && d <= reach && melee.ready(self)) {
          melee.start(self, o.x, o.y);
          this.strikes--;
        }
        if ((this.strikes <= 0 && !melee.attacking(self)) || now >= this.until) {
          this.mode = 'back';
          this.until = now + rng.range(A.back[0], A.back[1]);
        }
        break;
    }
    // Упёрся в стену, обходя, — в другую сторону.
    if (Math.hypot(vx, vy) > 10 && self.moveSpeed < 8) {
      if ((this.stuck += dt) > 0.4) {
        this.dir = this.dir === 1 ? -1 : 1;
        this.stuck = 0;
      }
    } else this.stuck = 0;
    mover.drive(vx, vy);
  }
}
