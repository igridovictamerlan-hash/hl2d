import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Grenade } from '../systems/CombatSystem';
import { Gunner } from './Gunner';
import { lineOfSight } from '../world/visibility';
import { circleHitsSolid } from '../world/collision';
import { GRENADE } from '../config/combat';
import { CHARACTER } from '../config/entities';
import { FACTIONS } from '../config/factions';

const DIRS = 16;
/** Куда бежит (кэш на ~0,3 с, чтобы не дёргался) и от какой гранаты. */
const plan = new WeakMap<Character, { x: number; y: number; until: number; g: Grenade }>();

/** Заметил ли гранату: видит её (в угле обзора или вплотную) или бросил «свой» (крикнул «Граната!»). */
function noticed(self: Character, g: Grenade, ctx: AiContext): boolean {
  if (!lineOfSight(ctx.map, self.x, self.y, g.x, g.y)) return false;
  if (FACTIONS[g.thrower.faction].authority === FACTIONS[self.faction].authority) return true;
  return Gunner.inView(self, g.x, g.y);
}

/** Самая опасная граната рядом (ближайшая из замеченных) или null. */
export function grenadeDanger(self: Character, ctx: AiContext): Grenade | null {
  let best: Grenade | null = null;
  let bestD = GRENADE.radius + GRENADE.fleeMargin;
  for (const g of ctx.combat.grenades) {
    const d = Math.hypot(g.x - self.x, g.y - self.y);
    if (d < bestD && noticed(self, g, ctx)) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/**
 * Уклонение от гранаты поверх решения мозга: заметил гранату рядом — бежит прочь, предпочитая
 * место за стеной (вне прямой видимости от неё). Возвращает true, если убегает.
 */
export function dodgeGrenades(self: Character, ctx: AiContext): boolean {
  if (self.isPlayer || self.law.phase !== 'none' || ctx.combat.grenades.length === 0) return false;
  const now = ctx.combat.now;
  let p = plan.get(self);
  if (!p || now >= p.until || !ctx.combat.grenades.includes(p.g)) {
    const g = grenadeDanger(self, ctx);
    if (!g) {
      plan.delete(self);
      return false;
    }
    let bx = 0;
    let by = 0;
    let bestScore = -Infinity;
    for (let k = 0; k < DIRS; k++) {
      const a = (k / DIRS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const nx = self.x + dx * 40;
      const ny = self.y + dy * 40;
      if (circleHitsSolid(ctx.map, self.x + dx * 18, self.y + dy * 18, self.radius - 2) || circleHitsSolid(ctx.map, nx, ny, self.radius - 2)) continue;
      const fx = self.x + dx * 80;
      const fy = self.y + dy * 80;
      const far = !circleHitsSolid(ctx.map, fx, fy, self.radius - 2);
      const ex = far ? fx : nx;
      const ey = far ? fy : ny;
      let score = Math.hypot(ex - g.x, ey - g.y);
      if (!lineOfSight(ctx.map, g.x, g.y, ex, ey)) score += 120;
      if (score > bestScore) {
        bestScore = score;
        bx = dx;
        by = dy;
      }
    }
    if (bestScore === -Infinity) {
      const d = Math.hypot(self.x - g.x, self.y - g.y) || 1;
      bx = (self.x - g.x) / d;
      by = (self.y - g.y) / d;
    }
    // Крикнуть «Граната!» — один раз на гранату и не каждый (иначе хор).
    if (p?.g !== g && ctx.rng.chance(0.4) && (!self.speech || self.speech.until < now)) self.say('Граната!', now, 1.5);
    p = { x: bx, y: by, until: now + 0.3, g };
    plan.set(self, p);
  }
  self.wantX = p.x * CHARACTER.runSpeed;
  self.wantY = p.y * CHARACTER.runSpeed;
  self.aiming = false;
  return true;
}
