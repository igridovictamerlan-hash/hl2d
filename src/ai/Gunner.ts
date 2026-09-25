import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Rng } from '../core/rng';
import { canSeeCircle } from '../world/visibility';
import { faceTowards } from './facing';
import { COMBAT } from '../config/combat';
import { pointSegmentDist2 } from '../core/math';

const near: Character[] = [];

/**
 * Стрелок для ИИ: выбирает ближайшего видимого врага в дальности оружия, реагирует с задержкой,
 * стреляет очередями с паузами, перезаряжается, не стреляет, если на линии огня свой.
 */
export class Gunner {
  target: Character | null = null;
  private reaction = 0;
  private burst = 0;
  private pause = 0;
  private scan = 0;
  private lostFor = 0;

  constructor(private readonly rng: Rng) {}

  acquire(self: Character, ctx: AiContext): Character | null {
    const w = ctx.combat.weaponOf(self);
    if (!w) return null;
    let best: Character | null = null;
    let bestD = w.range;
    for (const o of ctx.entities.near(self.x, self.y, w.range, near)) {
      if (!ctx.combat.threat(self, o)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD && canSeeCircle(ctx.map, self.x, self.y, o.x, o.y, o.radius)) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Есть ли на линии огня свой (не враг цели). */
  private friendInLine(self: Character, t: Character, ctx: AiContext): boolean {
    const mx = (self.x + t.x) / 2;
    const my = (self.y + t.y) / 2;
    const half = Math.hypot(t.x - self.x, t.y - self.y) / 2;
    for (const o of ctx.entities.near(mx, my, half + 14, near)) {
      if (o === self || o === t || ctx.combat.isHostile(self, o)) continue;
      if (pointSegmentDist2(o.x, o.y, self.x, self.y, t.x, t.y) < (o.radius + 3) ** 2) return true;
    }
    return false;
  }

  /** Ведёт бой: true, если есть цель (даже если сейчас пауза/перезарядка). */
  update(self: Character, ctx: AiContext, dt: number): boolean {
    const combat = ctx.combat;
    const w = combat.weaponOf(self);
    if (!w) {
      this.target = null;
      return false;
    }
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.3;
      const t = this.acquire(self, ctx);
      if (t && t !== this.target) {
        this.target = t;
        this.reaction = this.rng.range(COMBAT.ai.reaction[0], COMBAT.ai.reaction[1]);
      }
    }
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      return false;
    }
    const d = Math.hypot(t.x - self.x, t.y - self.y);
    if (d > w.range * 1.1 || !canSeeCircle(ctx.map, self.x, self.y, t.x, t.y, t.radius)) {
      this.lostFor += dt;
      if (this.lostFor > 3) this.target = null;
      if (self.mag < w.magazine / 2) combat.reload(self);
      return this.target !== null;
    }
    this.lostFor = 0;
    faceTowards(self, t.x, t.y, dt);
    if (this.reaction > 0) {
      this.reaction -= dt;
      return true;
    }
    if (self.mag <= 0) {
      combat.reload(self);
      return true;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) this.burst = this.rng.int(COMBAT.ai.burst[0], COMBAT.ai.burst[1]);
      return true;
    }
    if (this.burst <= 0) this.burst = this.rng.int(COMBAT.ai.burst[0], COMBAT.ai.burst[1]);
    if (combat.canFire(self) && !this.friendInLine(self, t, ctx)) {
      combat.fire(self, t.x + t.vx * 0.1, t.y + t.vy * 0.1, COMBAT.ai.aimError);
      this.burst--;
      if (this.burst <= 0) this.pause = this.rng.range(COMBAT.ai.burstPause[0], COMBAT.ai.burstPause[1]);
    }
    return true;
  }
}
