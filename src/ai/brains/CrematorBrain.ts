import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Corpse } from '../../systems/CombatSystem';
import { Mover } from '../Mover';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorAround, zoneIds } from '../destinations';
import { LABOR } from '../../config/labor';

/**
 * Крематор (синтет Альянса): бродит по городу, находит тела и сжигает их (LABOR.cremator.burnTime с
 * пламени — тело исчезает вместе с лутом). В бою не участвует, ни с кем не говорит.
 */
export class CrematorBrain implements Brain {
  readonly mover = new Mover(LABOR.cremator.speed);
  private target: Corpse | null = null;
  private repath = 0;
  private readonly avoid: ReadonlySet<number>;

  constructor(self: Character, ctx: AiContext) {
    this.avoid = zoneIds(ctx, ['outlands', 'checkpoint', 'restricted']);
    this.mover.avoidZones = this.avoid;
    void self;
  }

  get stateName(): string {
    return this.target ? (this.target.burning ? 'сжигает тело' : 'идёт к телу') : 'патруль';
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const combat = ctx.combat;
    const now = combat.now;
    const C = LABOR.cremator;
    const t = this.target;
    if (t && !combat.corpses.includes(t)) this.target = null;
    if (!this.target) {
      // Ближайшее тело в городе, которое никто не сжигает.
      let best: Corpse | null = null;
      let bestD = Infinity;
      for (const c of combat.corpses) {
        if (c.cremator && c.cremator !== self && c.cremator.alive) continue;
        if (ctx.map.levelAt(c.x, c.y) !== 'city' || this.avoid.has(ctx.nav.zone[ctx.nav.nearestWalkable(c.x, c.y, 2)] ?? -1)) continue;
        const d = Math.hypot(c.x - self.x, c.y - self.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best) {
        best.cremator = self;
        this.target = best;
        this.repath = 0;
      }
    }
    const c = this.target;
    if (c) {
      if (Math.hypot(c.x - self.x, c.y - self.y) < C.reach) {
        this.mover.stop();
        faceTowards(self, c.x, c.y, dt);
        if (!c.burning) c.burning = now + C.burnTime;
        if (now >= c.burning) {
          combat.corpses.splice(combat.corpses.indexOf(c), 1);
          this.target = null;
        }
      } else {
        this.repath -= dt;
        if (this.repath <= 0 || this.mover.status === 'failed' || this.mover.status === 'idle') {
          this.repath = 2;
          const a = ctx.nav.nearestWalkable(c.x, c.y, 3);
          if (a >= 0) this.mover.goTo(self, ctx, a);
          else this.target = null;
        }
      }
    } else if (this.mover.status !== 'moving' && this.mover.status !== 'pending') {
      const a = randomAnchorAround(self, ctx, 15, 45, this.avoid);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
    this.mover.update(self, ctx, dt);
    faceMovement(self, ctx, dt);
  }
}
