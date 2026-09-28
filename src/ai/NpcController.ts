import type { AiContext } from './AiContext';
import { dodgeGrenades } from './Dodge';
import { CROUCH } from '../config/tactics';

/**
 * Обновляет мозги всех NPC (с уклонением от гранат) и обслуживает очередь поиска пути.
 * Тяжелораненый лежит (мозг ждёт); в бою NPC, стоящий на месте, садится (CROUCH), пошёл — встал.
 */
export function updateNpcs(ctx: AiContext, dt: number): void {
  const now = ctx.combat.now;
  for (const c of ctx.entities.list) {
    if (!c.alive || !c.brain) continue;
    if (c.downed) {
      c.wantX = c.wantY = 0;
      c.aiming = false;
      continue;
    }
    c.brain.update(c, ctx, dt);
    // Граната рядом — убегает, что бы ни решил мозг.
    dodgeGrenades(c, ctx);
    const still = c.wantX * c.wantX + c.wantY * c.wantY < CROUCH.npcStill * CROUCH.npcStill;
    // Поднимая раненого — на колене.
    c.crouch = c.reviving !== null || (still && (c.engagedUntil > now || c.suppress >= 0.3) && c.law.phase === 'none');
  }
  ctx.paths.process();
}
