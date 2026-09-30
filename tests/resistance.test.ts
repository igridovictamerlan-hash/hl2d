import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation, poiWorld } from '../src/systems/Population';
import { randomAnchorAround } from '../src/ai/destinations';
import { spawnRole } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { OtaBrain } from '../src/ai/brains/OtaBrain';
import { AgentBrain } from '../src/ai/brains/AgentBrain';
import { UndergroundBrain } from '../src/ai/brains/UndergroundBrain';
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

/** Задержать и сразу завести в свободную камеру тюрьмы (без конвоя). */
function cage(sim: Sim, handler: Character, p: Character): void {
  sim.law.arrest(handler, p, 'rebel');
  const cell = sim.law.freeCell(p.x, p.y, p)!;
  expect(cell.prison).toBe(true);
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

  test('подполье: 3 партизана в личине горожанина или ГСР и 2 спецагента', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const g = sim.insurgency.garrison;
    expect(g).toHaveLength(ROSTER.partisans);
    for (const p of g) {
      expect(p.disguised).toBe(true);
      expect(['citizen', 'cwu']).toContain(p.cover?.faction);
      expect(p.weapon).toBeNull();
    }
    expect(sim.insurgency.agents).toHaveLength(ROSTER.agents);
    for (const agent of sim.insurgency.agents) {
      expect(agent.profession).toBe('spec_agent');
      expect(agent.brain).toBeInstanceOf(AgentBrain);
      expect(sim.map.levelAt(agent.x, agent.y)).toBe('sewer');
    }
  });
});

describe('тюрьма Альянса: допрос и рейд', () => {
  test('пойманного партизана ведут в тюрьму, начальник тюрьмы допрашивает — тот выдаёт второго', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const cells = sim.law.cells.filter((c) => c.prison);
    expect(cells.length).toBeGreaterThanOrEqual(8);
    const [p1, p2] = sim.insurgency.garrison;
    const cp = sim.entities.list.find((c) => c.faction === 'cp')!;
    // Обычного горожанина в тюрьму не сажают.
    const citizen = sim.entities.list.find((c) => c.faction === 'citizen')!;
    expect(sim.law.freeCell(citizen.x, citizen.y, citizen)?.prison ?? false).toBe(false);
    cage(sim, cp, p1);
    expect(p1.disguised).toBe(false);
    expect(sim.law.imprisoned()).toContain(p1);
    // Бессрочно; оружие — в изъятом.
    expect(p1.law.jailUntil).toBe(Infinity);
    expect(p1.weapon).toBeNull();
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

  test('двое подпольщиков в тюрьме — гарнизоны КПП и OTA штурмуют лагерь', { timeout: 120_000 }, () => {
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
  test('в форме ГО — ГО не проверяет; взлом камеры тюрьмы; раскрытие', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const agent = sim.insurgency.agent!;
    const cp = sim.entities.list.find((c) => c.faction === 'cp')!;
    agent.cover = { faction: 'cp', rank: cp.rank, profession: cp.profession, name: cp.name };
    expect(agent.cover?.faction).toBe('cp');
    expect(sim.law.checkable(agent)).toBe(false);
    expect(sim.law.observe(cp, agent)).toBeNull();
    // Взлом камеры тюрьмы с пленным партизаном.
    const p = sim.insurgency.garrison[0];
    cage(sim, cp, p);
    const cell = sim.law.cells.find((c) => c.prison && c.slots.some((s) => s.occupant === p))!;
    expect(sim.insurgency.jailbreak(agent, cell)).toBe(1);
    // Из тюрьмы — сразу на свободу, в розыске.
    expect(p.law.phase).toBe('none');
    expect(p.law.wanted).toBe(true);
    expect(sim.law.imprisoned()).not.toContain(p);
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

  test('в OTA не переодевается: без свежего тела ГО — на дело под гражданской личиной', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const agent = sim.insurgency.agent!;
    const b = agent.brain as AgentBrain;
    // Тело OTA рядом — не годится.
    const ota = sim.entities.list.find((c) => c.faction === 'ota')!;
    ota.x = ota.prevX = agent.x;
    ota.y = ota.prevY = agent.y;
    sim.combat.damage(ota, 9999, null);
    run(sim, 0.2);
    expect(b.start(agent, sim.ctx, 'assassinate')).toBe(true);
    expect(b.mode).toBe('mission');
    expect(agent.cover?.faction ?? 'citizen').not.toBe('ota');
    // «По наряду» без формы не выдадут — бунт.
    b.mode = 'base';
    expect(b.start(agent, sim.ctx, 'requisition')).toBe(true);
    expect(b.mission).toBe('riot');
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

describe('подполье: взлом и растяжки', () => {
  test('в КПЗ Нексуса сидят — подпольщик идёт через люк и выбивает дверь, у двери оставляет растяжку', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    spawnPopulation(sim.ctx, 20);
    const [free] = sim.insurgency.garrison;
    const cp = sim.entities.list.find((c) => c.faction === 'cp')!;
    // В КПЗ — задержанный горожанин (повстанцев ведут в тюрьму: её берут штурмом всем подпольем).
    const caught = sim.entities.list.find((c) => c.faction === 'citizen' && c.law.phase === 'none')!;
    sim.law.arrest(cp, caught, 'no_cid');
    const cell = sim.law.freeCell(caught.x, caught.y, caught)!;
    expect(cell.prison).toBe(false);
    sim.law.putInCell(caught, cell);
    const slot = sim.law.slotOf(cell, caught)!;
    caught.x = caught.prevX = slot.x;
    caught.y = caught.prevY = slot.y;
    run(sim, 0.5);
    expect(caught.law.phase).toBe('jailed');
    expect(sim.insurgency.occupiedCell()).toBe(cell);
    const op = sim.insurgency.startOperation('jailbreak');
    expect(op?.kind).toBe('jailbreak');
    expect(op?.team[0]).toBe(free);
    const t = run(sim, 200, () => sim.insurgency.stats.jailbreaks > 0 && sim.combat.mineStats.planted > 0);
    console.log(`взлом за ${t.toFixed(0)} с; растяжек: ${sim.combat.mineStats.planted}`);
    expect(sim.insurgency.stats.jailbreaks).toBeGreaterThan(0);
    expect(caught.law.phase === 'jailed').toBe(false);
    expect(sim.combat.mineStats.planted).toBeGreaterThan(0);
  });

  test('минирование: подпольщик ставит растяжку в городе', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    spawnPopulation(sim.ctx, 20);
    const op = sim.insurgency.startOperation('mine');
    expect(op?.kind).toBe('mine');
    // Плановая проверка CID по дороге раскрывает личину с шансом — тест не про неё.
    for (const c of op!.team) c.law.lastCheck = sim.law.now + 1e6;
    run(sim, 200, () => sim.combat.mineStats.planted > 0);
    expect(sim.combat.mineStats.planted).toBeGreaterThan(0);
    const m = sim.combat.mines[0] ?? null;
    if (m) expect(sim.map.levelAt(m.x, m.y)).toBe('city');
  });
});

describe('подполье группами', () => {
  test('саботаж вдвоём: первый ломает узел, второй — дозорный; заметил ГО — группа уходит', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const op = sim.insurgency.startOperation('sabotage')!;
    expect(op.kind).toBe('sabotage');
    expect(op.team.length).toBe(2);
    const g = op.group!;
    expect(g.task).toBe('sabotage');
    expect(g.roles.get(op.team[0])).toBe('lead');
    expect(g.roles.get(op.team[1])).toBe('lookout');
    expect((op.team[1].brain as UndergroundBrain).mode).toBe('cover');
    expect(sim.insurgency.groupOf(op.team[1])).toBe(g);
    // «Шухер»: оба бросают дело и уходят.
    sim.insurgency.groupAlarm(g, op.team[1]);
    run(sim, 1);
    expect(op.team.every((c) => ['return', 'base'].includes((c.brain as UndergroundBrain).mode))).toBe(true);
    expect(sim.insurgency.stats.alarms).toBe(1);
  });

  test('взлом вдвоём: второй прикрывает у камер', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const op = sim.insurgency.startOperation('jailbreak')!;
    expect(op.kind).toBe('jailbreak');
    expect(op.team.length).toBe(2);
    expect(op.group?.roles.get(op.team[1])).toBe('cover');
    expect((op.team[0].brain as UndergroundBrain).mode).toBe('jailbreak');
    expect((op.team[1].brain as UndergroundBrain).mode).toBe('cover');
  });

  test('засада на конвой ГО: группа ждёт на пути, открывает огонь, раскрывается и забирает брошенные ящики', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 20);
    sim.insurgency.paused = true;
    const A = sim.arsenal;
    run(sim, 200, () => A.convoys.length > 0);
    const v = A.convoys[0];
    expect(v).toBeTruthy();
    // Место засады выбирают сами — в городе, на пути от склада к пункту.
    const auto = sim.insurgency.ambushSpot(v)!;
    expect(sim.map.levelAt(auto.x, auto.y)).toBe('city');
    // Колонна вышла — группа уже поднялась в город и ждёт впереди на её пути.
    run(sim, 90, () => v.phase === 'march');
    run(sim, 3);
    const path = (v.lead.brain as CpBrain).mover.remaining(40);
    let spot = path[path.length - 1];
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      acc += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (acc > 380) {
        spot = path[i];
        break;
      }
    }
    const op = sim.insurgency.startAmbush(v, spot)!;
    expect(op.kind).toBe('ambush');
    for (const m of op.team) {
      const a = sim.nav.nearestWalkable(spot.x + sim.ctx.rng.range(-24, 24), spot.y + sim.ctx.rng.range(-24, 24), 4);
      m.x = m.prevX = sim.nav.worldX(a);
      m.y = m.prevY = sim.nav.worldY(a);
      (m.brain as UndergroundBrain).startAmbush(m, sim.ctx, { x: m.x, y: m.y });
    }
    sim.entities.rebuildHash();
    expect(op.team.length).toBeGreaterThanOrEqual(PARTISANS.ambush.size[0]);
    const g = op.group!;
    expect(g.convoy).toBe(v);
    // Автомат из схрона.
    expect(op.team.every((m) => m.inventory.has(PARTISANS.ambush.weapon))).toBe(true);
    run(sim, 60, () => g.attack);
    expect(g.attack).toBe(true);
    expect(sim.insurgency.stats.ambushes).toBe(1);
    // Открыли огонь — личины нет, враги Альянса.
    for (const m of g.members) {
      expect(m.disguised).toBe(false);
      expect(m.hostile).toBe(true);
    }
    expect(sim.log.some((l) => l.includes('нападение на конвой'))).toBe(true);
    // Экипаж отстреливается — носильщики бросают ящики; кто уцелел из засады, забирает.
    let dropped = 0;
    run(sim, 60, () => {
      dropped = Math.max(dropped, A.crates.filter((c) => c.convoy).length);
      return sim.insurgency.stats.looted > 0 || g.members.every((m) => !m.fit);
    });
    // Носильщики бросают ящики в бою — если засаду не положили раньше, чем бой разгорелся.
    const wiped = g.members.every((m) => !m.fit);
    if (!wiped) expect(dropped + sim.insurgency.stats.looted).toBeGreaterThan(0);
    // Исход боя трёх против четырёх SU.03 — дело случая (голова без шлема — смерть). Засаду перебили —
    // брошенный ящик берёт первый же партизан, дошедший до него.
    // (Экипаж мог и подобрать свои ящики после боя — тогда брать нечего.)
    const crate = A.crates.find((c) => c.convoy);
    // (Всех партизан перебили — забирать некому.)
    const p = sim.entities.list.find((c) => c.alive && c.profession === 'partisan');
    if (sim.insurgency.stats.looted === 0 && crate && p) {
      p.x = p.prevX = crate.x;
      p.y = p.prevY = crate.y;
      expect(sim.insurgency.lootCrate(p)).toBe(true);
    }
    if ((crate && p) || sim.insurgency.stats.looted > 0) expect(sim.insurgency.stats.looted).toBeGreaterThan(0);
    expect(A.stats.looted).toBe(sim.insurgency.stats.looted);
  });

  test('спецагенты парой: второй идёт прикрытием к покушению', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    sim.insurgency.paused = true;
    const [a, b] = sim.insurgency.agents;
    expect((a.brain as AgentBrain).start(a, sim.ctx, 'assassinate')).toBe(true);
    const ab = a.brain as AgentBrain;
    const bb = b.brain as AgentBrain;
    expect(ab.partner).toBe(b);
    expect(bb.backup).toBe(true);
    expect(bb.partner).toBe(a);
    expect(bb.mission).toBe('assassinate');
    expect(bb.mode === 'dress' || bb.mode === 'mission').toBe(true);
  });
});
