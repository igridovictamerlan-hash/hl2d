import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Mover } from './Mover';
import type { Gunner } from './Gunner';
import type { HatchTravel } from './HatchTravel';
import type { Vec2 } from '../core/math';
import type { Cell } from '../systems/LawSystem';
import type { UndergroundGroup } from '../systems/InsurgencySystem';
import { PRISON } from '../config/prison';
import { CHARACTER } from '../config/entities';
import { faceTowards } from './facing';
import { Tactician } from './Tactics';
import { COMBAT, GRENADE } from '../config/combat';
import { canSeeCircle, castRay } from '../world/visibility';

/**
 * Штурм тюрьмы подпольем (партизаны и спецагенты — общая группа UndergroundGroup task 'prison'):
 *  сбор — под личиной через люк к своему месту у тюрьмы (spot), огня не открывают; ведущий, когда все
 *    собрались (или ждали PRISON.assault.wait с), даёт сигнал — InsurgencySystem.prisonAttack;
 *  штурм — личины долой, каждый к своей занятой камере (разные — group.cells), перебежками
 *    (стреляет shoot с — бежит dash с), у двери breakTime с — дверь выбита, к следующей; все камеры
 *    пусты или бой дольше fight с — конец (мозг уводит к люку).
 */
export class PrisonAssault {
  private cell: Cell | null = null;
  private work = 0;
  private shooting = false;
  private phase = 0;
  private repath = 0;
  private volley = false;
  /** Бой из-за укрытий (углы, блоки двора). */
  private readonly tactics = new Tactician();

  constructor(readonly spot: Vec2) {}

  /** Ранен так, что пора уходить: до сигнала — как обычно, в штурме — только тяжело. */
  static tooHurt(self: Character, g: UndergroundGroup | null): boolean {
    const f = g?.attack ? PRISON.assault.woundedLeave : COMBAT.woundedFraction;
    return self.health < self.maxHealth * f;
  }

  /** Огонь запрещён: до сигнала и если не ранили недавно (решает мозг). */
  static holdFire(g: UndergroundGroup | null, hurt: boolean): boolean {
    return !g?.attack && !hurt;
  }

  /** Шаг: true — ещё в деле, false — закончил (домой). */
  step(self: Character, ctx: AiContext, g: UndergroundGroup | null, travel: HatchTravel, mover: Mover, gunner: Gunner, dt: number, fighting: boolean): boolean {
    const P = PRISON.assault;
    if (!g || g.alarm) return false;
    const city = ctx.map.levelAt(self.x, self.y) === 'city';
    this.repath -= dt;
    if (!g.attack) {
      const d = Math.hypot(this.spot.x - self.x, this.spot.y - self.y);
      // Засветился (выдали на допросе, раскрыли на проверке): у тюрьмы — штурм сейчас, далеко — к люку.
      if (!self.disguised) {
        if (city && d < P.early) {
          ctx.insurgency.prisonAttack(g, self);
          return true;
        }
        return false;
      }
      if (city && d < 28) {
        travel.stop(mover);
        const c = ctx.prison.center;
        if (c) faceTowards(self, c.x, c.y, dt);
      } else {
        const st = travel.update(self, ctx, mover, dt);
        if ((st === 'idle' || st === 'failed') && this.repath <= 0) {
          this.repath = 2;
          if (st === 'failed' && !city) return false;
          travel.start(self, ctx, mover, this.spot);
        }
      }
      // Ведущий: все на местах (или ждали долго) — сигнал.
      if (self === g.lead && city) {
        const ready = g.members.every((m) => m === self || (ctx.map.levelAt(m.x, m.y) === 'city' && Math.hypot(m.x - self.x, m.y - self.y) < P.huddle));
        // Патруль ГО рядом (не охрана тюрьмы) — переждать, пока уйдёт.
        let patrol = false;
        for (const o of ctx.entities.near(self.x, self.y, P.patrolClear, near)) {
          const duty = (o.brain as { duty?: string } | null)?.duty;
          if (o.fit && o.faction === 'cp' && duty !== 'jailer' && duty !== 'warden') {
            patrol = true;
            break;
          }
        }
        if ((ready && d < 40 && !patrol) || ctx.insurgency.now - g.since > P.wait) ctx.insurgency.prisonAttack(g, self);
      }
      return true;
    }
    if (ctx.insurgency.now - g.firedAt > P.fight) return false;
    mover.speed = CHARACTER.runSpeed * 0.8;
    // По сигналу — граната в охрану на виду (раз).
    if (!this.volley) {
      this.volley = true;
      let best: Character | null = null;
      let bestD = Infinity;
      for (const o of ctx.entities.list) {
        if (!o.fit || o.faction !== 'cp') continue;
        const d = Math.hypot(o.x - self.x, o.y - self.y);
        if (d > GRENADE.maxThrow || d < GRENADE.ai.minDist || d >= bestD || !canSeeCircle(ctx.map, self.x, self.y, o.x, o.y, o.radius)) continue;
        // Граната долетит (стену и ограду не перелетает — иначе рванёт у своих) и своих у цели нет.
        const land = castRay(ctx.map, self.x, self.y, (o.x - self.x) / d, (o.y - self.y) / d, d) - 8;
        if (land < d - 24 || land < GRENADE.radius + 12) continue;
        if (g.members.some((m) => m.alive && Math.hypot(m.x - o.x, m.y - o.y) < GRENADE.radius + 16)) continue;
        best = o;
        bestD = d;
      }
      if (best && self.inventory.has('grenade')) ctx.combat.throwGrenade(self, best.x, best.y, 'grenade');
    }
    const cells = (g.cells ??= new Map());
    if (!this.cell || !this.cell.slots.some((s) => s.occupant)) {
      const taken = new Set<Cell>();
      for (const [m, c] of cells) if (m !== self && m.alive) taken.add(c);
      this.cell = ctx.prison.occupiedCellNear(self.x, self.y, taken) ?? ctx.prison.occupiedCellNear(self.x, self.y);
      this.work = 0;
      if (!this.cell) {
        cells.delete(self);
        return false;
      }
      cells.set(self, this.cell);
      travel.start(self, ctx, mover, { x: this.cell.frontX, y: this.cell.frontY });
    }
    const cell = this.cell;
    // Сперва охрана: цель на виду — стоит и стреляет, пока не упадёт или не скроется (в спину охране
    // к двери не бегут); вблизи двери — перебежками (постоять, пострелять, рывок).
    this.phase -= dt;
    const close = Math.hypot(cell.frontX - self.x, cell.frontY - self.y) < P.reach * 3;
    // Вдали от двери — бой из укрытия (угол, блок), как у армии; вблизи — перебежками.
    if (fighting && gunner.target && !close && this.tactics.fight(self, ctx, gunner, mover, dt, null, P.leash)) return true;
    if (this.tactics.mode !== 'none' && !(fighting && gunner.target)) {
      this.tactics.reset(self);
      this.repath = 0;
    }
    if (fighting && gunner.target) {
      if (!close) this.shooting = true;
      else if (this.phase <= 0) {
        this.shooting = !this.shooting;
        this.phase = this.shooting ? ctx.rng.range(P.shoot[0], P.shoot[1]) : ctx.rng.range(P.dash[0], P.dash[1]);
      }
    } else this.shooting = false;
    const d = Math.hypot(cell.frontX - self.x, cell.frontY - self.y);
    if (city && d < P.reach) {
      travel.stop(mover);
      if (!gunner.target) faceTowards(self, cell.x, cell.y, dt);
      this.work += dt;
      if (this.work >= P.breakTime) {
        ctx.insurgency.jailbreak(self, cell);
        cells.delete(self);
        this.cell = null;
      }
      return true;
    }
    if (this.shooting) {
      mover.stop();
      return true;
    }
    const st = travel.update(self, ctx, mover, dt);
    if ((st === 'idle' || st === 'failed' || st === 'arrived') && this.repath <= 0) {
      this.repath = 1.5;
      travel.start(self, ctx, mover, { x: cell.frontX, y: cell.frontY });
    }
    return true;
  }
}

const near: Character[] = [];
