import { generateCity } from '../src/world/generator/CityGenerator';
import { NavGrid } from '../src/world/NavGrid';
import { EntityManager } from '../src/entities/EntityManager';
import { PathService } from '../src/ai/PathService';
import { AnchorBfs } from '../src/ai/yieldSearch';
import type { AiContext } from '../src/ai/AiContext';
import { Rng } from '../src/core/rng';
import { updateNpcs } from '../src/ai/NpcController';
import { stepPhysics } from '../src/entities/physics';
import type { GameMap } from '../src/world/GameMap';

/** Безголовая симуляция мира: карта + NPC + физика, без DOM и отрисовки. */
export function makeSim(seedOrMap: number | GameMap) {
  const map = typeof seedOrMap === 'number' ? generateCity(seedOrMap) : seedOrMap;
  const nav = new NavGrid(map);
  const entities = new EntityManager();
  const ctx: AiContext = {
    map,
    nav,
    paths: new PathService(map, nav),
    bfs: new AnchorBfs(nav),
    entities,
    rng: new Rng(777),
    player: null,
    time: 0,
  };
  const step = (dt = 1 / 60) => {
    ctx.time += dt;
    updateNpcs(ctx, dt);
    stepPhysics(entities, map, dt);
  };
  return { map, nav, entities, ctx, step };
}
