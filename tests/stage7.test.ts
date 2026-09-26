import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { AStar } from '../src/ai/AStar';
import { createCharacter } from '../src/entities/factory';
import { spawnPopulation, poiWorld, armySpec } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { ROSTER, COMMAND } from '../src/config/roster';
import { ELECTION } from '../src/config/election';
import { AI } from '../src/config/ai';
import { randomAnchorAround } from '../src/ai/destinations';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, secs: number, until?: () => boolean): number {
  for (let t = 0; t < secs * 60; t++) {
    sim.step();
    if (until?.()) return t / 60;
  }
  return secs;
}

const zoneKind = (sim: Sim, x: number, y: number) => sim.map.zoneAtWorld(x, y)?.kind;

describe('пустошь и лагерь сопротивления', () => {
  test('от лагеря прямой путь по тропе к пустошам обоих КПП; люков два, ходят партизаны', () => {
    const sim = makeSim(12345);
    const camp = poiWorld(sim.ctx, 'rebel_camp')!;
    expect(zoneKind(sim, camp.x, camp.y)).toBe('rebel_camp');
    const astar = new AStar(sim.nav);
    const from = sim.nav.nearestWalkable(camp.x, camp.y, 4);
    for (const f of sim.war.fronts) {
      const to = sim.nav.nearestWalkable(f.exit.x, f.exit.y, 6);
      const path = astar.find(from, to);
      expect(path).not.toBeNull();
      // Путь идёт через пустошь, в город не заходит.
      for (const a of path!) {
        const k = sim.map.zones[sim.nav.zone[a]]?.kind;
        expect(['rebel_camp', 'wasteland', 'outlands', 'checkpoint']).toContain(k);
      }
    }
    expect(sim.map.hatches).toHaveLength(2);
    const p = createCharacter(sim.entities, sim.ctx.rng, 'rebel', 0, 0);
    p.profession = 'partisan';
    expect(sim.ctx.underground.canUse(p)).toBe(true);
    p.profession = 'rebel_soldier';
    expect(sim.ctx.underground.canUse(p)).toBe(false);
  });
});

describe('постоянный состав', () => {
  test('армия в лагере: глава, ветераны, солдаты, пиро, подрывник и HYDRA; резерв OTA; партизаны', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const army = sim.war.command.army;
    const count = (prof: string) => army.filter((c) => c.profession === prof).length;
    for (const [prof, n] of [...ROSTER.army, ...ROSTER.hydra]) expect(count(prof)).toBe(n);
    expect(sim.war.command.leader?.maxHealth).toBe(ROSTER.hp.rebel_leader);
    for (const c of army) expect(zoneKind(sim, c.x, c.y)).toBe('rebel_camp');
    expect(sim.war.ota).toHaveLength(ROSTER.ota.reduce((n, [, k]) => n + k, 0));
    expect(sim.insurgency.garrison.every((c) => c.profession === 'partisan')).toBe(true);
    expect(sim.insurgency.garrison).toHaveLength(ROSTER.partisans);
    // У всех NPC — роль (по ней возвращаются после гибели).
    expect(sim.entities.list.filter((c) => !c.isPlayer && !c.role && c.profession !== 'cremator')).toHaveLength(0);
  });

  test('погибший возвращается на спавн своей стороны: боец — в лагерь, гражданин — в квартал', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    const total = sim.entities.list.length;
    const soldier = sim.war.command.army.find((c) => c.profession === 'rebel_soldier')!;
    const civ = sim.entities.list.find((c) => c.faction === 'citizen' && c.role?.kind === 'citizen')!;
    const names = [soldier.name, civ.name];
    sim.combat.damage(soldier, 1000, null);
    sim.combat.damage(civ, 1000, null);
    run(sim, Math.max(ROSTER.respawn.army, ROSTER.respawn.citizen) + 1);
    const back = names.map((n) => sim.entities.list.find((c) => c.alive && c.name === n));
    expect(back[0]).toBeTruthy();
    expect(back[1]).toBeTruthy();
    expect(zoneKind(sim, back[0]!.x, back[0]!.y)).toBe('rebel_camp');
    expect(back[1]!.brain).toBeInstanceOf(CitizenBrain);
    // Новых персонажей сверх состава не появилось (крематор выходит сам — не в счёт).
    expect(sim.entities.list.filter((c) => c.alive && c.profession !== 'cremator').length).toBeLessThanOrEqual(total);
    expect(sim.roster.respawned).toBe(2);
  });
});

describe('командование сопротивления', () => {
  test('глава выбирает КПП: большинство идёт туда тропой, отвлекающая группа — на второй', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const cmd = sim.war.command;
    run(sim, 70);
    expect(cmd.stats.retargets).toBeGreaterThanOrEqual(1);
    const target = sim.war.fronts[cmd.target];
    const atTarget = cmd.army.filter((c) => (c.brain as RebelBrain).front === target.index && sim.war.frontAt(c.x, c.y) === target);
    const other = cmd.army.filter((c) => (c.brain as RebelBrain).front !== target.index);
    console.log(`у КПП главы: ${atTarget.length}, отвлекают: ${other.length}`);
    expect(atTarget.length).toBeGreaterThanOrEqual(8);
    expect(other.length).toBe(COMMAND.diversion);
    expect(other.length).toBeLessThan(cmd.army.length / 2);
  });

  test('клич главы: бойцы рядом идут за ним на штурм', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    const spot = (k: number) => {
      const a = f.outlands[(k * 7) % f.outlands.length];
      return { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
    };
    const leader = spawnRole(sim.ctx, armySpec('rebel_leader', 'rebel_leader', 4), spot(0))!;
    const men = [1, 2, 3, 4].map((k) => spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_raider', 0), spot(k))!);
    sim.war.command.target = 0;
    for (const c of [leader, ...men]) (c.brain as RebelBrain).march('gather');
    expect(sim.war.command.shout(leader)).toBeNull();
    expect(sim.war.command.shout(leader)).toMatch(/не готов/);
    run(sim, 1);
    for (const m of men) {
      if (Math.hypot(m.x - leader.x, m.y - leader.y) > COMMAND.rally.radius) continue;
      expect(sim.war.command.rallyFor(m)).toBe(leader);
      expect((m.brain as RebelBrain).mode).toBe('capture');
    }
  });
});

describe('выборы Администратора', () => {
  test('Администратор погиб — выборы среди лоялистов, победитель занимает кабинет', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    // Пара лоялистов.
    const civ = sim.entities.list.filter((c) => c.faction === 'citizen').slice(0, 3);
    civ.forEach((c, i) => (c.loyalty = ELECTION.minLoyalty + 10 * (i + 1)));
    const admin = sim.entities.list.find((c) => c.faction === 'admin')!;
    sim.combat.damage(admin, 1000, null);
    const e = sim.ctx.elections.current!;
    expect(e).not.toBeNull();
    expect(e.candidates.length).toBeLessThanOrEqual(ELECTION.candidates);
    expect(e.candidates.every((c) => c.loyalty >= ELECTION.minLoyalty)).toBe(true);
    run(sim, ELECTION.duration + 2);
    expect(sim.ctx.elections.held).toBe(1);
    const next = sim.entities.list.filter((c) => c.alive && c.faction === 'admin');
    expect(next).toHaveLength(1);
    expect(e.candidates).toContain(next[0]);
    expect(e.votes.reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
    // Старый не возрождается — только выборы.
    run(sim, 5);
    expect(sim.entities.list.filter((c) => c.alive && c.faction === 'admin')).toHaveLength(1);
  });
});

describe('бандиты', () => {
  test('NPC-бандит грабит прохожего в подворотне', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    let bandit = null as ReturnType<typeof spawnRole>;
    for (const a of sim.nav.walkable) {
      if (zoneKind(sim, sim.nav.worldX(a), sim.nav.worldY(a)) !== 'residential') continue;
      const at = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
      bandit = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'bandit', division: null, rank: 0, kit: 'bandit' }, at);
      // Прохожие в соседних переулках.
      for (let k = 0; k < 24; k++) {
        const b = randomAnchorAround(at, sim.ctx, 2, 18, new Set());
        if (b < 0) continue;
        const v = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen' }, { x: sim.nav.worldX(b), y: sim.nav.worldY(b) });
        if (v) v.money = 50;
      }
      break;
    }
    expect(bandit).toBeTruthy();
    expect(bandit!.weapon).toBeNull();
    run(sim, 240, () => sim.crime.stats.robberies > 0);
    expect(sim.crime.stats.robberies).toBeGreaterThan(0);
    expect(AI.population.banditShare).toBeGreaterThan(0);
  });
});
