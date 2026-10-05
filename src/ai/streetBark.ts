import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import { bark, barkSide } from '../systems/Barks';
import { BARKS } from '../config/barks';

/**
 * Реплика на улице: у горожан и ВС — через разговоры (Talk.remark): слух, который знает, обстановка (голод,
 * ночь, код, бой на КПП, недавний вызов по рации) или бытовое — без повторов. У повстанцев — как раньше:
 * если у КПП бой — о нём (слышно из города), иначе бытовое. В канализации о границе не говорят.
 */
export function streetBark(self: Character, ctx: AiContext): void {
  const now = ctx.combat.now;
  const side = barkSide(self);
  if (side !== 'rebel' && ctx.talk) {
    if (ctx.talk.busy(self)) return;
    bark(self, 'ambient', now, ctx.rng, () => ctx.talk.remark(self, side === 'combine' ? 'cp' : 'walk', side === 'combine' ? [] : BARKS.lines[side].ambient));
    return;
  }
  const war = ctx.war;
  const fighting = war && ctx.map.levelAt(self.x, self.y) === 'city' && war.fronts.some((f) => war.active(f));
  bark(self, fighting && ctx.rng.chance(0.5) ? 'warNews' : 'ambient', now, ctx.rng);
}
