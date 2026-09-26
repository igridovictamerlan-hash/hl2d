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
import { EconomySystem } from '../src/systems/EconomySystem';
import { CombatSystem } from '../src/systems/CombatSystem';
import { WarSystem } from '../src/systems/WarSystem';
import { UndergroundSystem } from '../src/systems/UndergroundSystem';
import { InsurgencySystem } from '../src/systems/InsurgencySystem';
import { LaborSystem } from '../src/systems/LaborSystem';
import { CrimeSystem } from '../src/systems/CrimeSystem';
import { ScannerSystem } from '../src/systems/ScannerSystem';
import { RosterSystem } from '../src/systems/Roster';
import { ElectionSystem } from '../src/systems/ElectionSystem';
import { StreetLifeSystem } from '../src/systems/StreetLife';

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
  const economy = new EconomySystem(map, entities, bus, rng);
  const combat = new CombatSystem(map, entities, bus, rng, law);
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
    bus,
    economy,
    combat,
    underground: new UndergroundSystem(map, nav, entities),
    war: null as unknown as WarSystem,
    insurgency: null as unknown as InsurgencySystem,
    labor: null as unknown as LaborSystem,
    crime: null as unknown as CrimeSystem,
    scanners: null as unknown as ScannerSystem,
    roster: null as unknown as RosterSystem,
    elections: null as unknown as ElectionSystem,
    street: null as unknown as StreetLifeSystem,
  };
  const war = new WarSystem(ctx);
  ctx.war = war;
  const insurgency = new InsurgencySystem(ctx);
  ctx.insurgency = insurgency;
  const labor = new LaborSystem(ctx);
  ctx.labor = labor;
  const crime = new CrimeSystem(ctx);
  ctx.crime = crime;
  const scanners = new ScannerSystem(ctx);
  ctx.scanners = scanners;
  const roster = new RosterSystem(ctx);
  ctx.roster = roster;
  const elections = new ElectionSystem(ctx);
  ctx.elections = elections;
  const street = new StreetLifeSystem(ctx);
  ctx.street = street;
  economy.onEmpty = () => labor.noticeEmpty();
  law.curfewCheck = (c) => war.curfewViolation(c);
  law.panicking = (c) => c.panicUntil > law.now;
  const step = (dt = 1 / 60) => {
    ctx.time += dt;
    updateNpcs(ctx, dt);
    doors.update(entities, dt);
    stepPhysics(entities, map, dt);
    law.update(dt, null);
    economy.update(dt);
    combat.update(dt);
    war.update(dt);
    insurgency.update(dt);
    labor.update(dt);
    scanners.update(dt);
    roster.update(dt);
    elections.update(dt);
    street.update(dt);
  };
  return { map, nav, entities, ctx, step, bus, law, doors, log, economy, combat, war, insurgency, labor, crime, scanners, roster, elections, street };
}
