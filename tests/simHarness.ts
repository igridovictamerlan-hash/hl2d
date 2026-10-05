import { resetCids } from '../src/entities/factory';
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
import { FamilySystem } from '../src/systems/Families';
import { SecuritySystem } from '../src/systems/Security';
import { CwuHqSystem } from '../src/systems/CwuHq';
import { ArsenalSystem } from '../src/systems/Arsenal';
import { PrisonSystem } from '../src/systems/Prison';
import { StreetShops } from '../src/systems/StreetShops';
import { Housing } from '../src/systems/Housing';
import { Fence } from '../src/systems/Fence';
import { Routine } from '../src/systems/Routine';
import { Errands } from '../src/systems/Errands';
import { Brawls } from '../src/systems/Brawls';
import { GangSystem } from '../src/systems/Gangs';
import { StreetLifeSystem } from '../src/systems/StreetLife';
import { AcademySystem } from '../src/systems/Academy';
import { Staffing } from '../src/systems/Staffing';
import { Access } from '../src/systems/Access';

/** Безголовая симуляция мира: карта + NPC + двери + закон + физика, без DOM и отрисовки. */
export function makeSim(seedOrMap: number | GameMap) {
  // Номера CID — общий набор модуля: без сброса случайность теста зависит от предыдущих тестов.
  resetCids();
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
    families: null as unknown as FamilySystem,
    security: null as unknown as SecuritySystem,
    cwuHq: null as unknown as CwuHqSystem,
    arsenal: null as unknown as ArsenalSystem,
    prison: null as unknown as PrisonSystem,
    shops: null as unknown as StreetShops,
    housing: null as unknown as Housing,
      fence: null as unknown as Fence,
      gangs: null as unknown as GangSystem,
      routine: null as unknown as Routine,
      errands: null as unknown as Errands,
      brawls: null as unknown as Brawls,
      academy: null as unknown as AcademySystem,
      staffing: null as unknown as Staffing,
      access: null as unknown as Access,
  };
  // Распорядок дня в тестах выключен (иначе ночью город спит) — у него свой тест.
  ctx.routine = new Routine(ctx, false);
  ctx.errands = new Errands(ctx);
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
  ctx.families = new FamilySystem(ctx);
  const security = new SecuritySystem(ctx);
  ctx.security = security;
  const cwuHq = new CwuHqSystem(ctx);
  ctx.cwuHq = cwuHq;
  const arsenal = new ArsenalSystem(ctx);
  ctx.arsenal = arsenal;
  const prison = new PrisonSystem(ctx);
  ctx.prison = prison;
  ctx.shops = new StreetShops(ctx);
  ctx.housing = new Housing(ctx);
  ctx.fence = new Fence(ctx);
  ctx.gangs = new GangSystem(ctx);
  ctx.brawls = new Brawls(ctx);
  ctx.staffing = new Staffing(ctx);
  ctx.academy = new AcademySystem(ctx);
  // Набор в академию в тестах выключен (свой тест) — иначе лоялисты уходят учиться.
  ctx.academy.recruiting = false;
  ctx.access = new Access(ctx);
  // Случайные драки в тестах выключены (свой тест) — удары и братва работают.
  ctx.brawls.enabled = false;
  economy.onEmpty = () => labor.noticeEmpty();
  law.curfewCheck = (c) => war.curfewViolation(c);
  law.panicking = (c) => c.panicUntil > law.now;
  law.trespass = (c) => ctx.access.trespassing(c);
  law.merit = (c, pts) => ctx.staffing.merit(c, pts);
  const step = (dt = 1 / 60) => {
    ctx.time += dt;
    updateNpcs(ctx, dt);
    doors.update(entities, dt);
    stepPhysics(entities, map, dt);
    ctx.access.update();
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
    security.update(dt);
    cwuHq.update(dt);
    ctx.shops.update();
    ctx.gangs.update(dt);
    ctx.brawls.update(dt);
    arsenal.update(dt);
    prison.update();
    ctx.staffing.update();
    ctx.academy.update(dt);
  };
  return { map, nav, entities, ctx, step, bus, law, doors, log, economy, combat, war, insurgency, labor, crime, scanners, roster, elections, street, security, cwuHq, arsenal, prison, academy: ctx.academy, staffing: ctx.staffing, access: ctx.access };
}
