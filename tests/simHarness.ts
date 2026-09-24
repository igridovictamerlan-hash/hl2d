import { generateCity } from '../src/world/generator/CityGenerator';
import { NavGrid } from '../src/world/NavGrid';
import { EntityManager } from '../src/entities/EntityManager';
import { PathService } from '../src/ai/PathService';
import { AnchorBfs } from '../src/ai/yieldSearch';
import type { AiContext } from '../src/ai/AiContext';
import { Rng } from '../src/core/rng';
import { EventBus } from '../src/core/EventBus';
import { updateNpcs } from '../src/ai/NpcController';
import { stepPhysics } from '../src/entities/physics';
import { DoorSystem } from '../src/systems/DoorSystem';
import { LawSystem } from '../src/systems/LawSystem';
import type { GameMap } from '../src/world/GameMap';

/** Безголовая симуляция мира: карта + NPC + двери + закон + физика, без DOM и отрисовки. */
export function makeSim(seedOrMap: number | GameMap) {
  const map = typeof seedOrMap === 'number' ? generateCity(seedOrMap) : seedOrMap;
  const nav = new NavGrid(map);
  const entities = new EntityManager();
  const bus = new EventBus();
  const rng = new Rng(777);
  const doors = new DoorSystem(map, nav);
  const law = new LawSystem(map, nav, doors, entities, bus, rng);
  const log: string[] = [];
  bus.on('log', ({ text }) => log.push(text));
  const ctx: AiContext = {
    map,
    nav,
    paths: new PathService(map, nav),
    bfs: new AnchorBfs(nav),
    entities,
    rng,
    player: null,
    time: 0,
    law,
    doors,
  };
  const step = (dt = 1 / 60) => {
    ctx.time += dt;
    updateNpcs(ctx, dt);
    doors.update(entities, dt);
    stepPhysics(entities, map, dt);
    law.update(dt, null);
  };
  return { map, nav, entities, ctx, step, bus, law, doors, log };
}
