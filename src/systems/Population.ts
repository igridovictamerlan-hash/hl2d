import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { FactionId } from '../config/factions';
import { FACTIONS } from '../config/factions';
import { AI } from '../config/ai';
import { createCharacter } from '../entities/factory';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { PostBrain } from '../ai/brains/PostBrain';
import { randomAnchorAround, zoneIds } from '../ai/destinations';
import { dist } from '../core/math';

/** Точка в px мира для POI. */
export function poiWorld(ctx: Pick<AiContext, 'map'>, type: Parameters<AiContext['map']['poisOf']>[0], k = 0): { x: number; y: number } | null {
  const p = ctx.map.poisOf(type)[k];
  if (!p) return null;
  const ts = ctx.map.tileSize;
  return { x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts };
}

/** Свободный проходимый якорь у точки (не ближе minGap к другим персонажам). */
function freeSpot(ctx: AiContext, around: { x: number; y: number }, rMin: number, rMax: number, avoid: ReadonlySet<number>, minGap = 40): { x: number; y: number } | null {
  for (let tries = 0; tries < 200; tries++) {
    const a = rMax <= 0 ? ctx.nav.nearestWalkable(around.x, around.y, 4) : randomAnchorAround(around, ctx, rMin, rMax, avoid);
    if (a < 0 || avoid.has(ctx.nav.zone[a])) continue;
    const x = ctx.nav.worldX(a);
    const y = ctx.nav.worldY(a);
    if (ctx.entities.list.some((c) => dist(c.x, c.y, x, y) < minGap)) continue;
    return { x, y };
  }
  return null;
}

function randomRank(ctx: AiContext, faction: FactionId, maxRank: number): number {
  const n = FACTIONS[faction].ranks?.length ?? 1;
  // Младших рангов больше: берём минимум из двух бросков.
  return Math.min(ctx.rng.int(0, Math.min(maxRank, n - 1)), ctx.rng.int(0, Math.min(maxRank, n - 1)));
}

/**
 * Заселение города: граждане (часть у площади), рабочие ГСР, повстанцы, патрули ГО,
 * часовые пограничных КПП, Администратор в Нексусе.
 */
export function spawnPopulation(ctx: AiContext, citizens: number): void {
  const P = AI.population;
  const civAvoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands']);
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const anywhere = { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const add = (faction: FactionId, spot: { x: number; y: number } | null, rank = 0): Character | null => {
    if (!spot) return null;
    const c = createCharacter(ctx.entities, ctx.rng, faction, spot.x, spot.y, false, rank);
    c.facing = ctx.rng.range(0, Math.PI * 2);
    return c;
  };

  const nearPlaza = Math.min(6, citizens);
  for (let k = 0; k < citizens; k++) {
    const spot = k < nearPlaza ? freeSpot(ctx, plaza, 3, 22, civAvoid) : freeSpot(ctx, anywhere, 0, 110, civAvoid);
    const c = add('citizen', spot);
    if (c) c.brain = new CitizenBrain(c, ctx);
  }
  for (let k = 0; k < P.cwu; k++) {
    const c = add('cwu', freeSpot(ctx, plaza, 3, 30, civAvoid));
    if (c) c.brain = new CitizenBrain(c, ctx);
  }
  for (let k = 0; k < P.rebels; k++) {
    const c = add('rebel', freeSpot(ctx, anywhere, 40, 110, civAvoid), randomRank(ctx, 'rebel', 4));
    if (c) c.brain = new CitizenBrain(c, ctx);
  }
  const nexus = poiWorld(ctx, 'nexus_gate') ?? plaza;
  const none = new Set<number>();
  for (let k = 0; k < P.cpPatrol; k++) {
    const c = add('cp', freeSpot(ctx, k < 2 ? nexus : anywhere, 2, k < 2 ? 12 : 100, none), randomRank(ctx, 'cp', 6));
    if (c) c.brain = new CpBrain(c, ctx);
  }
  // Часовые КПП: пост в коридоре, лицом к пустошам.
  const outs = ctx.map.poisOf('outlands_exit');
  ctx.map.poisOf('checkpoint_post').forEach((p, k) => {
    if (Math.floor(k / 2) >= outs.length || k % 2 >= P.cpPerCheckpoint) return;
    const ts = ctx.map.tileSize;
    const post = { x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts };
    const out = outs[Math.floor(k / 2)];
    const facing = Math.atan2((out.y + 0.5) * ts - post.y, (out.x + 0.5) * ts - post.x);
    const c = add('cp', freeSpot(ctx, post, 0, 0, none, 20), randomRank(ctx, 'cp', 5));
    if (c) {
      c.facing = facing;
      c.brain = new CpBrain(c, ctx, post, facing);
    }
  });
  if (P.admin > 0) {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) {
      const c = add('admin', freeSpot(ctx, desk, 0, 0, none, 10));
      if (c) c.brain = new PostBrain({ x: c.x, y: c.y }, ctx.rng.range(0, Math.PI * 2));
    }
  }
}

/** Где появляется игрок в выбранной роли. */
export function roleSpawn(ctx: AiContext, faction: FactionId): { x: number; y: number } {
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const none = new Set<number>();
  let spot: { x: number; y: number } | null = null;
  if (faction === 'cp') {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) spot = freeSpot(ctx, desk, 1, 4, none, 30);
  } else if (faction === 'rebel') {
    // Подальше от Нексуса, в жилых кварталах.
    const avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'plaza', 'avenue']);
    const nexus = poiWorld(ctx, 'nexus_gate') ?? plaza;
    for (let k = 0; k < 20 && !spot; k++) {
      const s = freeSpot(ctx, { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 }, 20, 110, avoid);
      if (s && dist(s.x, s.y, nexus.x, nexus.y) > 700) spot = s;
    }
  }
  if (!spot) spot = freeSpot(ctx, plaza, 0, 8, zoneIds(ctx, ['nexus', 'cells']), 30);
  if (!spot) {
    const a = ctx.nav.nearestWalkable(plaza.x, plaza.y, 10);
    spot = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
  }
  return spot;
}
