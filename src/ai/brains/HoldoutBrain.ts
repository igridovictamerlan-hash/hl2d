/** Описание системы — docs/response.md. */
import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { BuildingPlan, Exit, Response } from '../../systems/Response';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, turnTowards } from '../facing';
import { CHARACTER } from '../../config/entities';
import { RESPONSE } from '../../config/response';

type Phase = 'enter' | 'hold' | 'escape' | 'surrender';

const NAMES: Record<Phase, string> = { enter: 'уходит в дом', hold: 'засел', escape: 'уходит через выход', surrender: 'сдаётся' };

/**
 * Засевший вооружённый (временный мозг поверх прежнего; Response.tryHoldout): уходит в здание — в дальнюю от входа
 * комнату, садится лицом ко входу в неё и стреляет в каждого, кто покажется (свой Gunner). Раз в escapeEvery с — выход
 * без поста ВС: с шансом уходит через него (прежний мозг; операция — снова на улице). На уговоры — сдаётся
 * (surrender): ствол на землю, к ближайшему выходу, наружу — и стоит с поднятыми руками, пока не задержат.
 */
export class HoldoutBrain implements Brain {
  readonly mover = new Mover(CHARACTER.runSpeed * 0.9);
  readonly gunner: Gunner;
  phase: Phase = 'enter';
  /** Сдался (ствол бросил) и вышел наружу. */
  surrendered = false;
  out = false;
  private spot: Vec2;
  private face = 0;
  private started = -1;
  private escapeAt = 0;
  private exit: Exit | null = null;
  private repath = 0;

  constructor(private readonly response: Response, readonly plan: BuildingPlan, readonly entry: Exit, readonly saved: Brain | null, rng: Rng) {
    this.gunner = new Gunner(rng);
    // Дальняя комната от входа: в ширину по дверям, последняя.
    const order = [entry.room];
    const seen = new Set(order);
    for (let k = 0; k < order.length; k++) {
      for (const r of plan.rooms[order[k]].links.keys()) {
        if (seen.has(r)) continue;
        seen.add(r);
        order.push(r);
      }
    }
    const far = plan.rooms[order[order.length - 1]] ?? plan.rooms[entry.room];
    // Место — дальше всего от входа здания; лицом — к центру комнаты (оттуда войдут).
    let best = far.spots[0] ?? { x: far.cx, y: far.cy };
    let bestD = -1;
    for (const p of far.spots) {
      const d = Math.hypot(p.x - entry.door.x, p.y - entry.door.y);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    this.spot = best;
    this.face = Math.atan2(far.cy - best.y, far.cx - best.x);
  }

  get stateName(): string {
    return `засевший · ${NAMES[this.phase]}${this.gunner.target ? ' · бой' : ''}`;
  }

  /** Сидит в укрытии (присед — NpcController). */
  get sits(): boolean {
    return this.phase === 'hold';
  }

  /** Вернуть прежнюю жизнь (побег, конец операции, задержание). */
  finish(self: Character): void {
    self.task = '';
    self.surrendering = false;
    if (self.brain === this) self.brain = this.saved;
    self.wantX = self.wantY = 0;
  }

  /** Сдаться: ствол — на землю (в карман), не враг, к ближайшему выходу с поднятыми руками. */
  surrender(self: Character, ctx: AiContext): void {
    if (this.surrendered) return;
    this.surrendered = true;
    this.phase = 'surrender';
    self.surrendering = true;
    ctx.combat.equip(self, null);
    self.hostile = false;
    self.aiming = false;
    this.gunner.target = null;
    self.say(ctx.rng.pick(RESPONSE.lines.surrender), ctx.law.now, 3);
    let best: Exit = this.plan.exits[0];
    for (const e of this.plan.exits) if (Math.hypot(e.inside.x - self.x, e.inside.y - self.y) < Math.hypot(best.inside.x - self.x, best.inside.y - self.y)) best = e;
    this.exit = best;
    this.repath = 0;
  }

  private goTo(self: Character, ctx: AiContext, p: Vec2, dt: number): void {
    this.repath -= dt;
    const st = this.mover.status;
    if (this.repath <= 0 || st === 'idle' || st === 'failed') {
      this.repath = 1.5;
      const a = ctx.nav.nearestWalkable(p.x, p.y, 2);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    }
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const H = RESPONSE.holdout;
    const now = ctx.combat.now;
    if (this.started < 0) {
      this.started = now;
      this.escapeAt = now + H.escapeEvery;
    }
    if (self.law.phase !== 'none') return;
    if (this.phase === 'surrender') {
      const e = this.exit!;
      self.task = this.out ? 'hands' : '';
      if (!this.out) {
        this.mover.speed = CHARACTER.walkSpeed;
        this.goTo(self, ctx, e.out, dt);
        if (Math.hypot(e.out.x - self.x, e.out.y - self.y) < 14 || this.mover.status === 'arrived') this.out = true;
        this.mover.update(self, ctx, dt);
        faceMovement(self, ctx, dt);
      } else {
        this.mover.stop();
        this.mover.update(self, ctx, dt);
        turnTowards(self, Math.atan2(e.ny, e.nx), dt, 3);
      }
      return;
    }
    const fighting = this.gunner.update(self, ctx, dt) && !!this.gunner.target;
    if (this.phase === 'enter') {
      this.goTo(self, ctx, this.spot, dt);
      if (Math.hypot(this.spot.x - self.x, this.spot.y - self.y) < 12 || this.mover.status === 'arrived' || now - this.started > H.enterGiveUp) {
        this.phase = 'hold';
        this.mover.stop();
      }
    } else if (this.phase === 'hold') {
      this.mover.stop();
      // Выход без поста — уйти через него.
      if (now >= this.escapeAt) {
        this.escapeAt = now + H.escapeEvery;
        const e = this.response.openExit(this.plan, self);
        if (e && !fighting && ctx.rng.chance(H.escape)) {
          this.exit = e;
          this.phase = 'escape';
          this.mover.speed = CHARACTER.runSpeed;
        }
      }
    } else if (this.phase === 'escape') {
      const e = this.exit!;
      const far = { x: e.out.x + e.nx * 220, y: e.out.y + e.ny * 220 };
      this.goTo(self, ctx, Math.hypot(e.out.x - self.x, e.out.y - self.y) > 30 && this.response.buildingAt(self.x, self.y) === this.plan.id ? e.out : far, dt);
      if (this.response.buildingAt(self.x, self.y) !== this.plan.id && Math.hypot(far.x - self.x, far.y - self.y) < 60) {
        this.response.escaped(self);
        this.finish(self);
        return;
      }
      if (this.mover.status === 'failed') {
        this.phase = 'hold';
        this.repath = 0;
      }
    }
    this.mover.update(self, ctx, dt);
    if (this.gunner.look(self, ctx, dt)) return;
    if (this.phase === 'hold') turnTowards(self, this.face, dt, 3);
    else faceMovement(self, ctx, dt);
  }
}
