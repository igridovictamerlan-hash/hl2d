import type { AiContext } from './AiContext';
import { dodgeGrenades } from './Dodge';

/** Обновляет мозги всех NPC (с уклонением от гранат) и обслуживает очередь поиска пути. */
export function updateNpcs(ctx: AiContext, dt: number): void {
  for (const c of ctx.entities.list) {
    if (!c.alive || !c.brain) continue;
    c.brain.update(c, ctx, dt);
    // Граната рядом — убегает, что бы ни решил мозг.
    dodgeGrenades(c, ctx);
  }
  ctx.paths.process();
}
