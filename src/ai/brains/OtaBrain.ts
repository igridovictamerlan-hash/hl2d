import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, turnTowards } from '../facing';
import { randomAnchorAround } from '../destinations';
import { poiWorld } from '../../systems/Population';
import { LAW } from '../../config/law';

export type OtaMode = 'reserve' | 'post' | 'hunt' | 'home';

/**
 * Солдат OTA — постоянный резерв Цитадели.
 *  reserve — стоит у ворот Нексуса, ждёт приказа;
 *  post — контрудар: бежит на пост захваченной точки КПП и держит его (WarSystem.counterattack);
 *  hunt — красный код: идёт к последней известной позиции прорвавшихся, стреляет на поражение;
 *  home — отбой: возвращается к воротам Нексуса (там снова reserve).
 */
export class OtaBrain implements Brain {
  readonly mover = new Mover(95);
  readonly gunner: Gunner;
  mode: OtaMode = 'reserve';
  front = -1;
  post: Vec2 | null = null;
  private facing = 0;
  private repath = 0;
  /** Больше не используется: OTA возвращаются в резерв, а не уходят. */
  departed = false;

  constructor(_self: Character, ctx: AiContext) {
    this.gunner = new Gunner(ctx.rng);
  }

  get stateName(): string {
    const m = { reserve: 'резерв', post: 'контрудар', hunt: 'охота', home: 'возврат' }[this.mode];
    return this.gunner.target ? `${m} · бой` : m;
  }

  /** Свободен для приказа (в резерве). */
  get available(): boolean {
    return this.mode === 'reserve';
  }

  assignPost(front: number, post: Vec2, facing: number): void {
    this.mode = 'post';
    this.front = front;
    this.post = post;
    this.facing = facing;
    this.repath = 0;
  }

  hunt(): void {
    this.mode = 'hunt';
    this.front = -1;
    this.post = null;
    this.repath = 0;
  }

  goHome(): void {
    this.mode = 'home';
    this.front = -1;
    this.post = null;
    this.repath = 0;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const fighting = this.gunner.update(self, ctx, dt);
    this.repath -= dt;
    const st = this.mover.status;
    if (fighting && this.gunner.target) {
      ctx.war.sighted(this.gunner.target);
      this.mover.stop();
    } else if (this.mode === 'post' && this.post) {
      const p = this.post;
      const far = Math.hypot(p.x - self.x, p.y - self.y);
      this.mover.speed = far > LAW.cpRunToPost ? LAW.cpRunSpeed : 95;
      if (far < 14) {
        this.mover.stop();
        turnTowards(self, this.facing, dt, 3);
      } else if (this.repath <= 0 || st === 'idle' || st === 'failed') {
        this.repath = 3;
        const a = ctx.nav.nearestWalkable(p.x, p.y, 3);
        if (a >= 0) this.mover.goTo(self, ctx, a);
      }
    } else if (this.mode === 'hunt') {
      this.mover.speed = 95;
      if (this.repath <= 0 || st === 'arrived' || st === 'failed') {
        this.repath = 3;
        const p = ctx.war.nearestKnown(self.x, self.y);
        const a = p ? ctx.nav.nearestWalkable(p.x, p.y, 6) : randomAnchorAround(self, ctx, 10, 40, new Set());
        if (a >= 0) this.mover.goTo(self, ctx, a);
      }
    } else {
      // Резерв и возврат: у ворот Нексуса.
      const g = poiWorld(ctx, 'nexus_gate');
      if (g) {
        const d = Math.hypot(g.x - self.x, g.y - self.y);
        if (this.mode === 'home' && d < 60) this.mode = 'reserve';
        if (d > 70 && (this.repath <= 0 || st === 'idle' || st === 'failed')) {
          this.repath = 3;
          this.mover.speed = 95;
          const a = ctx.nav.nearestWalkable(g.x, g.y, 6);
          if (a >= 0) this.mover.goTo(self, ctx, a);
        } else if (d <= 70 && st === 'arrived') this.mover.stop();
      }
    }
    this.mover.update(self, ctx, dt);
    if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
  }
}
