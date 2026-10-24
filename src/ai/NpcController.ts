/** Описание системы — docs/population.md. */
import type { AiContext } from './AiContext';
import type { Character } from '../entities/Character';
import { dodgeGrenades } from './Dodge';
import { CROUCH } from '../config/tactics';

/**
 * Обновляет мозги всех NPC (с уклонением от гранат) и обслуживает очередь поиска пути.
 * Тяжелораненый лежит (мозг ждёт); в бою NPC, стоящий на месте, садится (CROUCH), пошёл — встал. Боец линии
 * фронта сидит на позиции и без боя (Brain.sits).
 * Упрощённая симуляция (`ctx.lod`, config/population.ts — LOD): NPC вдали от игрока, не в кадре и не занятый
 * (`busy`) думает раз в `every` тиков с шагом × `every` (совсем далеко — раз в `farEvery`), в остальные тики идёт,
 * куда шёл (wantX/wantY остаются).
 */
export function updateNpcs(ctx: AiContext, dt: number): void {
  const now = ctx.combat.now;
  const lod = ctx.lod ?? null;
  if (lod) lod.tick++;
  for (const c of ctx.entities.list) {
    if (!c.alive || !c.brain) continue;
    if (c.downed) {
      c.wantX = c.wantY = 0;
      c.aiming = false;
      c.lodFar = false;
      continue;
    }
    let step = dt;
    if (lod) {
      const dx = c.x - lod.x;
      const dy = c.y - lod.y;
      const d2 = dx * dx + dy * dy;
      c.lodFar = d2 > lod.r2 && !c.visible && !busy(c, now);
      if (c.lodFar) {
        const every = d2 > lod.farR2 ? lod.farEvery : lod.every;
        if ((lod.tick + c.id) % every !== 0) continue;
        step = dt * every;
      }
    } else c.lodFar = false;
    c.brain.update(c, ctx, step);
    // Граната рядом — убегает, что бы ни решил мозг.
    dodgeGrenades(c, ctx);
    const still = c.wantX * c.wantX + c.wantY * c.wantY < CROUCH.npcStill * CROUCH.npcStill;
    // Поднимая раненого — на колене.
    c.crouch = c.reviving !== null || c.notepadUntil > now || (still && (c.engagedUntil > now || c.suppress >= 0.3 || c.brain.sits === true) && c.law.phase === 'none');
  }
  ctx.paths.process();
}

/**
 * Занят тем, где важен каждый тик: бой (огонь, укрытия), под огнём, драка на кулаках, проверка и конвой, тащит или
 * поднимает раненого, рядом граната.
 */
function busy(c: Character, now: number): boolean {
  return (
    c.engagedUntil > now || c.suppress > 0.05 || c.melee.attack !== null || c.melee.stance > now || c.law.phase !== 'none' ||
    c.law.handler !== null || c.guarding !== null || c.dragging !== null || c.reviving !== null || c.lastHurt > now - 3
  );
}
