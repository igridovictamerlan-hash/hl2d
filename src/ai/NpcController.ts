import type { AiContext } from './AiContext';

/** Обновляет мозги всех NPC и обслуживает очередь поиска пути. */
export function updateNpcs(ctx: AiContext, dt: number): void {
  for (const c of ctx.entities.list) {
    if (c.alive && c.brain) c.brain.update(c, ctx, dt);
  }
  ctx.paths.process();
}
