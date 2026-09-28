import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, turnTowards } from '../facing';
import { poiWorld } from '../../systems/Population';
import { LAW } from '../../config/law';
import { Tactician } from '../Tactics';
import { TACTICS } from '../../config/tactics';
import { ARSENAL } from '../../config/arsenal';

export type OtaMode = 'reserve' | 'post' | 'home';

/**
 * Боец OTA (OTA.ALPHA, командир OTA.KING) — резерв Цитадели. Воюет только на КПП, по городу не ходит.
 *  reserve — ждёт приказа в комнате OTA в Нексусе (у своего шкафа; нет комнаты — у ворот);
 *  post — контрудар: бежит на пост захваченной точки КПП и держит его (WarSystem.counterattack);
 *  home — отбой: возвращается в комнату OTA (там снова reserve).
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
  /** Тактика боя: укрытия у поста, помощь своим раненым. */
  readonly tactics = new Tactician();
  private fightHome: Vec2 | null = null;
  /** Резерв: за патронами к пункту боепитания Нексуса (когда проверить снова). */
  private supply = false;
  private supplyCheck = 0;

  constructor(_self: Character, ctx: AiContext) {
    this.gunner = new Gunner(ctx.rng);
  }

  get stateName(): string {
    const m = { reserve: 'резерв', post: 'контрудар', home: 'возврат' }[this.mode];
    const tac = this.tactics.label;
    return this.gunner.target ? `${m} · бой${tac ? ` · ${tac}` : ''}` : m;
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

  goHome(): void {
    this.mode = 'home';
    this.front = -1;
    this.post = null;
    this.repath = 0;
  }

  /** Резерв с пустыми подсумками — к пункту боепитания Нексуса и назад. true — занят этим. */
  private supplyStep(self: Character, ctx: AiContext, dt: number): boolean {
    const A = ctx.arsenal;
    if (!A?.present) return false;
    if (!this.supply) {
      this.supplyCheck -= dt;
      if (this.supplyCheck > 0) return false;
      this.supplyCheck = ARSENAL.kpp.checkEvery;
      if (!A.needsNexus(self)) return false;
      this.supply = true;
      this.repath = 0;
    }
    const p = A.nexusPoint;
    if (!p) {
      this.supply = false;
      return false;
    }
    if (Math.hypot(p.x - self.x, p.y - self.y) < ARSENAL.kpp.reach) {
      this.mover.stop();
      const why = A.drawAt(self, p);
      self.say(why ?? ctx.rng.pick(ARSENAL.lines.point), ctx.law.now, 2);
      this.supply = false;
      return true;
    }
    if (this.repath <= 0 || this.mover.status === 'idle' || this.mover.status === 'failed') {
      this.repath = 3;
      this.mover.speed = 95;
      const a = ctx.nav.nearestWalkable(p.x, p.y, 3);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
    return true;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const fighting = this.gunner.update(self, ctx, dt);
    this.repath -= dt;
    const st = this.mover.status;
    if (!(fighting && this.gunner.target) && this.tactics.rescue(self, ctx, this.gunner, this.mover, dt)) {
      // Свой тяжелораненый — поднять.
    } else if (fighting && this.gunner.target) {
      ctx.war.sighted(this.gunner.target);
      // Из укрытия у поста (или там, где начался бой).
      this.fightHome ??= this.post ?? { x: self.x, y: self.y };
      if (!this.tactics.fight(self, ctx, this.gunner, this.mover, dt, this.fightHome, this.post ? TACTICS.postLeash : TACTICS.leash)) this.mover.stop();
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
    } else if (this.mode === 'reserve' && this.supplyStep(self, ctx, dt)) {
      // Резерв: за патронами к пункту Нексуса.
    } else {
      // Резерв и возврат: в комнате OTA, у своего шкафа (нет комнаты — у ворот Нексуса).
      const spots = ctx.map.poisOf('ota_spot');
      const g = spots.length ? poiWorld(ctx, 'ota_spot', self.id % spots.length) : poiWorld(ctx, 'nexus_gate');
      const near = spots.length ? 20 : 70;
      if (g) {
        const d = Math.hypot(g.x - self.x, g.y - self.y);
        if (this.mode === 'home' && d < near + 30) this.mode = 'reserve';
        if (d > near && (this.repath <= 0 || st === 'idle' || st === 'failed')) {
          this.repath = 3;
          this.mover.speed = 95;
          const a = ctx.nav.nearestWalkable(g.x, g.y, 6);
          if (a >= 0) this.mover.goTo(self, ctx, a);
        } else if (d <= near && st === 'arrived') this.mover.stop();
      }
    }
    if (!fighting) {
      this.fightHome = null;
      if (this.tactics.mode !== 'none') this.tactics.reset(self);
    }
    this.mover.update(self, ctx, dt);
    if (!this.gunner.look(self, ctx, dt) && !this.tactics.face(self, dt)) faceMovement(self, ctx, dt);
  }
}
