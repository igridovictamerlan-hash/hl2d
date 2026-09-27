import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation, poiWorld, armySpec, armyKit } from '../src/systems/Population';
import type { Character } from '../src/entities/Character';
import { spawnRole } from '../src/systems/Roster';
import { randomAnchorAround } from '../src/ai/destinations';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { OtaBrain } from '../src/ai/brains/OtaBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CP_UNIT, REBEL_UNIT, rebelUnitOf } from '../src/config/factions';
import { WAR } from '../src/config/war';
import { ROSTER } from '../src/config/roster';
import { T } from '../src/world/tiles';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): number {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (until && i % 30 === 0 && until()) return i / 60;
  }
  return seconds;
}

function spotNear(sim: Sim, p: { x: number; y: number }, r0: number, r1: number) {
  const a = randomAnchorAround(p, sim.ctx, r0, r1, new Set());
  return { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
}

describe('коды тревоги', () => {
  test('жёлтый — только когда ГО увидел убитого патрульного в городе', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    // Стрельба и тревога сами по себе код не меняют.
    sim.war.raiseAlarm(plaza.x, plaza.y, 'стрельба');
    expect(sim.war.code).toBe('green');
    const at = spotNear(sim, plaza, 0, 4);
    const victim = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, at)!;
    sim.combat.damage(victim, 9999, null);
    run(sim, 2);
    // Тело никто не видел — код зелёный.
    expect(sim.war.code).toBe('green');
    // Патрульный рядом видит тело — код жёлтый.
    spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, spotNear(sim, at, 2, 4));
    run(sim, 1);
    expect(sim.war.code).toBe('yellow');
    expect(sim.log.some((l) => l.includes('убитый патрульный'))).toBe(true);
  });

  test('красный код: возрождения нет ни у кого, после отбоя — снова', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    const admin = sim.entities.list.find((c) => c.faction === 'admin')!;
    const cit = sim.entities.list.find((c) => c.faction === 'citizen' && !c.isPlayer && c.role)!;
    const name = cit.name;
    expect(sim.war.setCode('red', admin)).toBeNull();
    sim.combat.damage(cit, 9999, null);
    run(sim, ROSTER.respawn.citizen + 5);
    expect(sim.entities.list.some((c) => c.alive && c.name === name)).toBe(false);
    expect(sim.war.setCode('green', admin)).toBeNull();
    run(sim, 3);
    expect(sim.entities.list.some((c) => c.alive && c.name === name)).toBe(true);
  });

  test('Администратор погиб при красном коде — выборов нет до отбоя', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    const admin = sim.entities.list.find((c) => c.faction === 'admin')!;
    const ofc = sim.entities.list.find((c) => c.faction === 'cp' && c.rank === CP_UNIT.ofc)!;
    expect(sim.war.setCode('red', ofc)).toBeNull();
    sim.combat.damage(admin, 9999, null);
    run(sim, 2);
    expect(sim.ctx.elections.current).toBeNull();
    expect(sim.war.setCode('green', ofc)).toBeNull();
    run(sim, 1);
    expect(sim.ctx.elections.current).not.toBeNull();
  });
});

describe('КПП', () => {
  test('лонг свободен: в нём нет бетонных блоков', () => {
    const sim = makeSim(12345);
    for (const f of sim.war.fronts) {
      let blocks = 0;
      let tiles = 0;
      for (let y = 0; y < sim.map.height; y++) {
        for (let x = 0; x < sim.map.width; x++) {
          if (sim.map.zoneGrid[y * sim.map.width + x] !== f.longZone) continue;
          tiles++;
          if (sim.map.tileAt(x, y) === T.BARRIER) blocks++;
        }
      }
      expect(tiles).toBeGreaterThan(30);
      expect(blocks).toBe(0);
    }
  });

  test('внутренний двор взят — сильнейшие встают у углов выхода в город', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const f = sim.war.fronts[0];
    const spots = sim.war.gateSpots(f);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    for (const p of spots) expect(Math.hypot(p.x - f.apron.x, p.y - f.apron.y)).toBeLessThanOrEqual(WAR.capture.gateHold.radius);
    // Внешний двор уже наш, штурмуют внутренний.
    f.held = 1;
    const men: Character[] = [];
    for (const [prof, n] of [['rebel_recruit', 3], ['veteran', 2], ['commando', 1], ['hydra_sergeant', 1], ['rebel_soldier', 3]] as const) {
      for (let k = 0; k < n; k++) {
        const a = f.points[1].floor[(men.length * 7) % f.points[1].floor.length];
        const r = spawnRole(sim.ctx, armySpec(prof, armyKit(prof), rebelUnitOf(prof)!.rank), { x: sim.nav.worldX(a), y: sim.nav.worldY(a) })!;
        (r.brain as RebelBrain).march('gather');
        f.squad.push(r);
        men.push(r);
      }
    }
    run(sim, 0.5);
    sim.war.startCapture(f);
    run(sim, 3, () => f.owner === 'rebels');
    expect(f.owner).toBe('rebels');
    const gate = men.filter((r) => {
      const p = (r.brain as RebelBrain).post;
      return p && spots.some((s) => s.x === p.x && s.y === p.y);
    });
    expect(gate.length).toBeGreaterThanOrEqual(3);
    expect(gate.length).toBeLessThanOrEqual(WAR.capture.gateHold.count);
    // У выхода — самые крепкие (коммандос, сержант, ветераны), а не новобранцы и рядовые.
    expect(gate.some((r) => r.profession === 'commando')).toBe(true);
    expect(gate.every((r) => r.maxHealth >= WAR.capture.gateHold.minHp)).toBe(true);
    expect(gate.some((r) => r.rank === REBEL_UNIT.recruit)).toBe(false);
  });

  test('OTA идут на КПП, где больше всего повстанцев', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    const busy = sim.war.fronts[1];
    for (let k = 0; k < WAR.ota.minRebels + 2; k++) {
      const a = busy.outlands[(k * 5) % busy.outlands.length];
      const r = spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_soldier', 0), { x: sim.nav.worldX(a), y: sim.nav.worldY(a) })!;
      (r.brain as RebelBrain).march('gather');
    }
    run(sim, WAR.ota.every + 1);
    const posted = sim.war.ota.filter((o) => (o.brain as OtaBrain).mode === 'post');
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((o) => (o.brain as OtaBrain).front === busy.index)).toBe(true);
    expect(sim.war.stats.otaDeployed).toBeGreaterThan(0);
  });
});

describe('место преступления', () => {
  test('тело ГО нашли — оцепление, следователь SU.01 и офицер, за ленту не пускают, тело не обыскать', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    sim.ctx.insurgency.paused = true;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    const at = spotNear(sim, plaza, 0, 4);
    const victim = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, at)!;
    sim.combat.damage(victim, 9999, null);
    const corpse = sim.combat.corpses[sim.combat.corpses.length - 1];
    spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, spotNear(sim, at, 2, 4));
    run(sim, 1);
    const scene = sim.war.scenes.list[0];
    expect(scene).toBeTruthy();
    expect(scene.corpse).toBe(corpse);
    expect(scene.cones.filter((c) => !Number.isNaN(c.x)).length).toBeGreaterThan(3);
    // Едут следователь SU.01 и офицер (PCU.OFC или SU.INSP).
    expect(scene.investigator?.rank).toBe(CP_UNIT.su1);
    expect([CP_UNIT.ofc, CP_UNIT.insp]).toContain(scene.officer?.rank);
    // Тело не обыскать не-сотруднику; житель внутри ленты выталкивается.
    const cit = sim.entities.list.find((c) => c.faction === 'citizen' && !c.isPlayer && c.alive)!;
    expect(sim.war.scenes.sealed(corpse, cit)).toBe(true);
    expect(sim.war.scenes.sealed(corpse, scene.officer)).toBe(false);
    cit.x = cit.prevX = corpse.x + 10;
    cit.y = cit.prevY = corpse.y;
    sim.step();
    expect(Math.hypot(cit.x - corpse.x, cit.y - corpse.y)).toBeGreaterThanOrEqual(scene.r);
    // Следователь доходит и осматривает тело, офицер стоит у ленты.
    const t = run(sim, 120, () => sim.war.scenes.stats.investigated > 0);
    console.log(`осмотр тела через ${t.toFixed(0)} с`);
    expect(corpse.scanned).toBe(true);
    const o = scene.officer!;
    const near = () => Math.hypot(o.x - scene.x, o.y - scene.y) < scene.r + 30;
    run(sim, 25, near);
    expect(near()).toBe(true);
    // Через holdAfter оцепление снимают, офицер возвращается к службе.
    run(sim, 40, () => scene.closed);
    expect(scene.closed).toBe(true);
    expect((o.brain as CpBrain).scene).toBeNull();
  });

  test('бандит обирает неоцеплённое тело ГО — забирает оружие', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    const at = spotNear(sim, plaza, 0, 4);
    const victim = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, at)!;
    sim.combat.damage(victim, 9999, null);
    const bandit = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'bandit', division: null, rank: 0, kit: 'citizen' }, spotNear(sim, at, 6, 10))!;
    run(sim, 60, () => sim.crime.stats.corpseLoots > 0);
    expect(sim.crime.stats.corpseLoots).toBeGreaterThan(0);
    expect(bandit.inventory.has('usp')).toBe(true);
  });
});

