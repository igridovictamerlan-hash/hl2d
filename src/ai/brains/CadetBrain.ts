import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Vec2 } from '../../core/math';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { followColumn } from '../Tactics';
import { faceMovement, faceTowards, turnTowards } from '../facing';
import { LAW } from '../../config/law';
import { CHARACTER } from '../../config/entities';
import { ACADEMY } from '../../config/academy';

/**
 * Курсант академии: делает то, что велит занятие (AcademySystem.task) — стоит в строю, идёт в колонне за
 * направляющим, бежит круг на физо, сидит за партой, стреляет на огневом рубеже по своей мишени, ест, спит у
 * своей койки. На него напали — отстреливается с места (учебный пистолет), потом снова на занятие.
 */
export class CadetBrain implements Brain {
  readonly mover = new Mover(LAW.cpWalkSpeed);
  readonly gunner: Gunner;
  readonly column = { repath: 0 };
  private goal: Vec2 | null = null;
  private repath = 0;
  private path: readonly Vec2[] | null = null;
  private idx = 0;
  private nextShot = 0;
  /** Выдержка курсанта: до какой доли прицела ждёт перед выстрелом; талант стрелка (у каждого свой). */
  private readonly patience: number;
  private readonly talent: number;
  private doing = 'занятие';

  constructor(self: Character, ctx: AiContext) {
    this.gunner = new Gunner(ctx.rng);
    this.patience = ctx.rng.range(0.45, 1);
    const T = ACADEMY.range.talent;
    this.talent = ctx.rng.range(T[0], T[1]);
    void self;
  }

  get stateName(): string {
    return `курсант · ${this.doing}`;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const A = ctx.academy;
    // Напали — отстреливается с места (по уставу: укрыться и доложить — но учебный пистолет при себе).
    if (this.gunner.update(self, ctx, dt) && this.gunner.target) {
      this.doing = 'бой';
      this.mover.stop();
      this.mover.update(self, ctx, dt);
      this.gunner.look(self, ctx, dt);
      return;
    }
    if (!A?.present) {
      this.mover.stop();
      this.mover.update(self, ctx, dt);
      return;
    }
    const t = A.task(self);
    const now = ctx.law.now;
    let face: number | null = null;
    let shooting = false;
    switch (t.kind) {
      case 'go': {
        this.path = null;
        this.doing = t.act === 'sleep' ? 'сон' : t.act === 'eat' ? 'обед' : t.act === 'sit' ? 'класс' : A.session === 'formation' ? 'строй' : A.session === 'range' ? 'ждёт смену' : 'личное время';
        if (this.reach(self, ctx, t.spot, dt, 10)) face = t.spot.facing;
        break;
      }
      case 'lead':
      case 'loop': {
        this.doing = t.kind === 'lead' ? 'строевая (направляющий)' : 'физо';
        if (this.path !== t.path) {
          this.path = t.path;
          this.idx = t.kind === 'loop' ? t.start : this.nearest(self, t.path);
          this.goal = null;
        }
        const p = t.path[this.idx % t.path.length];
        this.mover.speed = t.kind === 'loop' ? CHARACTER.runSpeed * ACADEMY.pt.speed : LAW.cpWalkSpeed * ACADEMY.drill.speed;
        if (Math.hypot(p.x - self.x, p.y - self.y) < 18) {
          this.idx = (this.idx + 1) % t.path.length;
          this.goal = null;
        } else this.goTo(self, ctx, p, dt);
        break;
      }
      case 'follow': {
        this.doing = 'строевая';
        this.path = null;
        this.goal = null;
        followColumn(self, ctx, this.mover, t.leader, t.k, dt, this.column, LAW.cpWalkSpeed * 1.25);
        break;
      }
      case 'shoot': {
        this.doing = 'огневой рубеж';
        this.path = null;
        if (!this.reach(self, ctx, t.spot, dt, 8)) break;
        shooting = true;
        if (self.weapon !== 'usp') ctx.combat.equip(self, 'usp');
        faceTowards(self, t.target.x, t.target.y, dt);
        self.aiming = true;
        if (self.mag <= 0) {
          ctx.combat.reload(self);
          break;
        }
        if (now >= this.nextShot && self.aim >= this.patience) {
          // Новичок «дёргает» — точка прицела гуляет; со стрельбами — меньше.
          const R = ACADEMY.range;
          const trained = Math.min(1, (self.cadet?.fire ?? 0) / ACADEMY.exam.need.fire);
          const e = R.tremor + R.error * (1 - this.talent) * (1 - R.learn * trained);
          const a = Math.atan2(t.target.y - self.y, t.target.x - self.x) + Math.PI / 2;
          const off = ctx.rng.range(-e, e);
          ctx.combat.fire(self, t.target.x + Math.cos(a) * off, t.target.y + Math.sin(a) * off);
          const P = ACADEMY.range.pause;
          this.nextShot = now + ctx.rng.range(P[0], P[1]);
        }
        break;
      }
    }
    if (!shooting) {
      self.aiming = false;
      if (self.weapon && !this.gunner.target) ctx.combat.equip(self, null);
    }
    this.mover.update(self, ctx, dt);
    if (shooting) return;
    if (face !== null) turnTowards(self, face, dt, 4);
    else faceMovement(self, ctx, dt);
  }

  /** Идти к месту; true — на месте (стоит). */
  private reach(self: Character, ctx: AiContext, p: Vec2, dt: number, near: number): boolean {
    if (Math.hypot(p.x - self.x, p.y - self.y) < near) {
      this.mover.stop();
      this.goal = null;
      return true;
    }
    // Далеко (опаздывает на занятие) — бегом.
    const far = Math.hypot(p.x - self.x, p.y - self.y) > 220;
    this.mover.speed = far ? LAW.cpRunSpeed : LAW.cpWalkSpeed * 1.15;
    this.goTo(self, ctx, p, dt);
    return false;
  }

  private goTo(self: Character, ctx: AiContext, p: Vec2, dt: number): void {
    this.repath -= dt;
    const moved = !this.goal || Math.hypot(this.goal.x - p.x, this.goal.y - p.y) > 4;
    const st = this.mover.status;
    if (!moved && this.repath > 0 && st !== 'failed' && st !== 'idle' && st !== 'arrived') return;
    if (!moved && st === 'arrived') return;
    this.goal = { x: p.x, y: p.y };
    this.repath = 2.5;
    const a = ctx.nav.nearestWalkable(p.x, p.y, 3);
    if (a >= 0) this.mover.goTo(self, ctx, a);
  }

  private nearest(self: Character, path: readonly Vec2[]): number {
    let best = 0;
    let bd = Infinity;
    path.forEach((p, k) => {
      const d = Math.hypot(p.x - self.x, p.y - self.y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  }
}
