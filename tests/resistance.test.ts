import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation, poiWorld } from '../src/systems/Population';
import { randomAnchorAround } from '../src/ai/destinations';
import { spawnRole } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { OtaBrain } from '../src/ai/brains/OtaBrain';
import { AgentBrain } from '../src/ai/brains/AgentBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { REBEL_RANKS, REBEL_UNIT, rebelUnitOf } from '../src/config/factions';
import { ROSTER } from '../src/config/roster';
import { PARTISANS } from '../src/config/underground';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): number {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (until && i % 30 === 0 && until()) return i / 60;
  }
  return seconds;
}

/** Задержать и сразу завести в свободную клетку (без конвоя). */
function cage(sim: Sim, handler: Character, p: Character): void {
  sim.law.arrest(handler, p, 'rebel');
  const cell = sim.law.freeCell(p.x, p.y, p)!;
  expect(cell.cage).toBe(true);
  sim.law.putInCell(p, cell);
  const slot = sim.law.slotOf(cell, p)!;
  p.x = p.prevX = slot.x;
  p.y = p.prevY = slot.y;
  run(sim, 0.5);
  expect(p.law.phase).toBe('jailed');
}

describe('юниты сопротивления', () => {
  test('новые ранги: здоровье, жёлтые и красные ники, Патрик', () => {
    const hp = (id: keyof typeof REBEL_UNIT) => REBEL_RANKS[REBEL_UNIT[id]].hp;
    expect(hp('recruit')).toBe(75);
    expect(hp('soldier')).toBe(90);
    expect(hp('veteran')).toBe(110);
    expect(hp('medic')).toBe(100);
    expect(hp('demo')).toBe(130);
    expect(hp('pyro')).toBe(130);
    expect(hp('leader')).toBe(250);
    expect(hp('hydra_rct')).toBe(150);
    expect(hp('hydra_sergeant')).toBe(170);
    expect(hp('hydra_sniper')).toBe(110);
    expect(hp('commando')).toBe(200);
    // Армия — жёлтые ники, глава и HYDRA — красные.
    expect(REBEL_RANKS[REBEL_UNIT.soldier].color).toBe(REBEL_RANKS[REBEL_UNIT.recruit].color);
    expect(REBEL_RANKS[REBEL_UNIT.leader].color).toBe(REBEL_RANKS[REBEL_UNIT.commando].color);
    expect(REBEL_RANKS[REBEL_UNIT.leader].color).not.toBe(REBEL_RANKS[REBEL_UNIT.soldier].color);
    expect(rebelUnitOf('commando')?.def.elite).toBe(true);
    expect(rebelUnitOf('rebel_soldier')?.def.elite).toBe(false);
    // Коммандос — один на сервер.
    expect(ROSTER.hydra.find(([p]) => p === 'commando')?.[1]).toBe(1);

    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const leader = sim.entities.list.find((c) => c.profession === 'rebel_leader')!;
    expect(leader.name).toBe(ROSTER.leaderName);
    expect(leader.maxHealth).toBe(250);
    const cmd = sim.entities.list.filter((c) => c.profession === 'commando');
    expect(cmd).toHaveLength(1);
    expect(cmd[0].maxHealth).toBe(200);
    expect(cmd[0].rank).toBe(REBEL_UNIT.commando);
  });

  test('подполье: 2 партизана в личине горожанина или ГСР и спецагент', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const g = sim.insurgency.garrison;
    expect(g).toHaveLength(ROSTER.partisans);
    for (const p of g) {
      expect(p.disguised).toBe(true);
      expect(['citizen', 'cwu']).toContain(p.cover?.faction);
      expect(p.weapon).toBeNull();
    }
    const agent = sim.insurgency.agent!;
    expect(agent.profession).toBe('spec_agent');
    expect(agent.brain).toBeInstanceOf(AgentBrain);
    expect(sim.map.levelAt(agent.x, agent.y)).toBe('sewer');
  });
});

describe('клетки у Администратора', () => {
  test('пойманного партизана сажают в клетку, CMD.EPU допрашивает — тот выдаёт второго', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const cages = sim.law.cells.filter((c) => c.cage);
    expect(cages.length).toBeGreaterThanOrEqual(2);
    const [p1, p2] = sim.insurgency.garrison;
    const cp = sim.entities.list.find((c) => c.faction === 'cp')!;
    // Обычного горожанина в клетку не сажают.
    const citizen = sim.entities.list.find((c) => c.faction === 'citizen')!;
    expect(sim.law.freeCell(citizen.x, citizen.y, citizen)?.cage ?? false).toBe(false);
    cage(sim, cp, p1);
    expect(p1.disguised).toBe(false);
    expect(sim.law.caged()).toContain(p1);
    const hp0 = p1.health;
    const t = run(sim, 200, () => sim.insurgency.stats.broke > 0);
    console.log(`допрос: раскололся через ${t.toFixed(0)} с`);
    expect(sim.insurgency.stats.interrogations).toBe(1);
    expect(sim.insurgency.stats.broke).toBe(1);
    expect(p1.health).toBeLessThan(hp0);
    expect(p1.health).toBeGreaterThanOrEqual(p1.maxHealth * PARTISANS.interrogation.minHealth - 0.01);
    // Выданный партизан (или спецагент) больше не под личиной и в розыске.
    const outed = [p2, sim.insurgency.agent].filter((c): c is Character => !!c && !c.disguised);
    expect(outed.length).toBe(1);
    expect(outed[0].law.wanted).toBe(true);
  });

  test('оба подпольщика в клетках — гарнизоны КПП и OTA штурмуют лагерь', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const [p1, p2] = sim.insurgency.garrison;
    const cp = sim.entities.list.find((c) => c.faction === 'cp')!;
    cage(sim, cp, p1);
    expect(sim.insurgency.raid).toBeNull();
    cage(sim, cp, p2);
    run(sim, 1);
    const raid = sim.insurgency.raid!;
    expect(raid).not.toBeNull();
    const guards = raid.force.filter((c) => c.brain instanceof CpBrain);
    const ota = raid.force.filter((c) => c.brain instanceof OtaBrain);
    console.log(`рейд: ${guards.length} SU и ${ota.length} OTA`);
    expect(guards.length).toBeGreaterThan(0);
    expect(ota.length).toBeGreaterThan(0);
    // Силы выходят за стену к лагерю.
    const camp = poiWorld(sim.ctx, 'rebel_camp')!;
    const near = () => raid.force.filter((c) => c.alive && Math.hypot(c.x - camp.x, c.y - camp.y) < 400).length;
    run(sim, PARTISANS.raid.duration - 10, () => near() >= 3);
    expect(near()).toBeGreaterThanOrEqual(3);
    run(sim, PARTISANS.raid.duration);
    expect(sim.insurgency.raid).toBeNull();
    for (const c of guards) expect((c.brain as CpBrain).raidPost).toBeNull();
  });
});

describe('спецагент', () => {
  test('переодевается в OTA — ГО не проверяет; взлом клетки; раскрытие', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const agent = sim.insurgency.agent!;
    sim.insurgency.dressAsOta(agent);
    expect(agent.cover?.faction).toBe('ota');
    const cp = sim.entities.list.find((c) => c.faction === 'cp')!;
    expect(sim.law.checkable(agent)).toBe(false);
    expect(sim.law.observe(cp, agent)).toBeNull();
    // Взлом клетки с пленным партизаном.
    const p = sim.insurgency.garrison[0];
    cage(sim, cp, p);
    const cell = sim.law.cells.find((c) => c.cage && c.slots.some((s) => s.occupant === p))!;
    expect(sim.insurgency.jailbreak(agent, cell)).toBe(1);
    expect(p.law.phase).toBe('releasing');
    expect(sim.law.caged()).not.toContain(p);
    expect(sim.war.alarmActive).toBe(true);
    // Покушение раскрывает агента.
    sim.insurgency.revealAgent(agent, 'покушение');
    expect(agent.cover).toBeNull();
    expect(agent.hostile).toBe(true);
    expect(agent.law.wanted).toBe(true);
  });

  test('переодевается в убитого сотрудника ГО', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    const agent = sim.insurgency.agent!;
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && (c.brain as CpBrain).duty === 'squad')!;
    sim.combat.damage(cp, 9999, null);
    run(sim, 0.2);
    const corpse = sim.combat.corpses.find((b) => b.name === cp.name)!;
    expect(corpse).toBeTruthy();
    sim.insurgency.dressAs(agent, corpse);
    expect(corpse.stripped).toBe(true);
    expect(agent.cover?.faction).toBe('cp');
    expect(agent.cover?.name).toBe(cp.name);
    expect(sim.law.checkable(agent)).toBe(false);
  });

  test('бунт: горожане вокруг бунтуют, ГО видит нарушение, тревога', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const people: Character[] = [];
    for (let k = 0; k < 6; k++) {
      const a = randomAnchorAround(p, sim.ctx, 1, 8, new Set());
      const c = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen', loyalty: 0 }, { x: sim.nav.worldX(a), y: sim.nav.worldY(a) })!;
      people.push(c);
    }
    const agent = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y, false);
    agent.profession = 'spec_agent';
    const n = sim.insurgency.startRiot(agent, p.x, p.y);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(sim.war.alarmActive).toBe(true);
    const rioters = people.filter((c) => (c.brain as CitizenBrain).fsm.current === 'riot');
    expect(rioters.length).toBe(n);
    run(sim, 3);
    const cp = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: 2, kit: 'cp' }, { x: rioters[0].x, y: rioters[0].y })!;
    cp.facing = 0;
    const r = rioters[0];
    r.x = r.prevX = cp.x + 40;
    r.y = r.prevY = cp.y;
    expect(sim.law.observe(cp, r)).toBe('riot');
    run(sim, PARTISANS.riot.time + 5);
    expect(people.every((c) => !c.alive || (c.brain as CitizenBrain | null)?.fsm?.current !== 'riot')).toBe(true);
  });

  test('маскировку снимает только убийство: ствол в руках и ранение — нет', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const p = sim.insurgency.garrison[0];
    expect(p.disguised).toBe(true);
    sim.combat.equip(p, 'rebel_pistol');
    expect(p.weapon).toBe('rebel_pistol');
    expect(p.disguised).toBe(true);
    const cp = sim.entities.list.find((c) => c.faction === 'cp')!;
    sim.combat.damage(cp, 5, p);
    expect(p.disguised).toBe(true);
    expect(p.hostile).toBe(false);
    expect(sim.combat.isHostile(cp, p)).toBe(false);
    sim.combat.damage(cp, 9999, p);
    expect(cp.alive).toBe(false);
    expect(p.disguised).toBe(false);
    expect(p.cover).toBeNull();
    expect(p.hostile).toBe(true);
    expect(p.law.wanted).toBe(true);
    // Подполье возвращается долго.
    expect(ROSTER.respawn.partisan).toBeGreaterThanOrEqual(300);
    expect(ROSTER.respawn.agent).toBeGreaterThan(ROSTER.respawn.partisan);
  });
});
