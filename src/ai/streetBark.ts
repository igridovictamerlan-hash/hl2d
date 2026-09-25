import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import { bark } from '../systems/Barks';

/**
 * Реплика на улице: если где-то идёт бой на КПП — чаще о нём (слышно из города), иначе — бытовое.
 * В канализации о границе не говорят.
 */
export function streetBark(self: Character, ctx: AiContext): void {
  const now = ctx.combat.now;
  const war = ctx.war;
  const fighting = war && ctx.map.levelAt(self.x, self.y) === 'city' && war.fronts.some((f) => war.active(f));
  bark(self, fighting && ctx.rng.chance(0.5) ? 'warNews' : 'ambient', now, ctx.rng);
}
