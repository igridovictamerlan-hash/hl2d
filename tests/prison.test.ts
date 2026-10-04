import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { validateMap } from '../src/world/generator/CityGenerator';
import { spawnPopulation, armySpec } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { UndergroundBrain } from '../src/ai/brains/UndergroundBrain';
import { ArmingBrain } from '../src/ai/brains/ArmingBrain';
import { CP_UNIT, cpUnit, type CpUnitId } from '../src/config/factions';
import { ITEMS } from '../src/config/items';
import { LAW } from '../src/config/law';
import { PRISON } from '../src/config/prison';
import { ARSENAL } from '../src/config/arsenal';
import { WEAPONS, AMMO_ITEM } from '../src/config/items';
import type { RoleSpec } from '../src/systems/Roster';
import { randomAnchorAround } from '../src/ai/destinations';
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

/** Задержать и сразу завести в камеру тюрьмы (без конвоя). */
function jail(sim: Sim, cp: Character, p: Character): void {
  sim.law.arrest(cp, p, 'rebel');
  const cell = sim.law.freeCell(p.x, p.y, p)!;
  expect(cell.prison).toBe(true);
  sim.law.putInCell(p, cell);
  const slot = sim.law.slotOf(cell, p)!;
  p.x = p.prevX = slot.x;
  p.y = p.prevY = slot.y;
  run(sim, 0.5);
  expect(p.law.phase).toBe('jailed');
}

const duty = (sim: Sim, d: string) => sim.entities.list.filter((c) => c.alive && c.brain instanceof CpBrain && c.brain.duty === d);

/** Точка в городе рядом с воротами тюрьмы (снаружи). */
function nearGate(sim: Sim, k = 0): { x: number; y: number } {
  const g = sim.law.prisonGate!;
  const a = randomAnchorAround(g, sim.ctx, 2 + k, 5 + k, new Set());
  return a >= 0 ? { x: sim.nav.worldX(a), y: sim.nav.worldY(a) } : g;
}

/**
 * Снять охрану тюрьмы (проверяется сам штурм, а не исход боя): без тел — иначе на убитых ВС поднимается
 * тревога, сбегаются патрули и исход решает бой с ними.
 */
function clearGuards(sim: Sim): void {
  for (const c of [...duty(sim, 'jailer'), ...duty(sim, 'warden')]) sim.entities.remove(c);
}

describe('тюрьма Протектората', () => {
  test('здание: 8 камер с решётками, посты, ворота; охрана SU.GUARD и третий инспектор', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    expect(sim.prison.present).toBe(true);
    const cells = sim.law.prisonCells;
    expect(cells).toHaveLength(8);
    for (const c of cells) {
      expect(c.door).toBeTruthy();
      expect(c.slots.length).toBeGreaterThanOrEqual(3);
    }
    const gate = sim.law.prisonGate!;
    expect(gate).toBeTruthy();
    expect(sim.prison.inside(gate.x, gate.y)).toBe(false);
    expect(sim.prison.posts).toHaveLength(7);
    for (const p of sim.prison.posts) expect(sim.prison.inside(p.x, p.y)).toBe(true);
    const jailers = duty(sim, 'jailer');
    expect(jailers).toHaveLength(PRISON.guards);
    for (const j of jailers) expect(j.rank).toBe(CP_UNIT.guard);
    const warden = duty(sim, 'warden');
    expect(warden).toHaveLength(1);
    // Третий инспектор: два в штабе и начальник тюрьмы.
    expect(sim.entities.list.filter((c) => c.faction === 'cp' && c.rank === CP_UNIT.insp)).toHaveLength(3);
    // Тюрьма — отдельно от Управы.
    const nx = sim.map.poisOf('nexus_gate')[0];
    const ts = sim.map.tileSize;
    expect(Math.hypot(gate.x - (nx.x + 0.5) * ts, gate.y - (nx.y + 0.5) * ts)).toBeGreaterThan(40 * ts);
    // Охрана при обходе остаётся в тюрьме.
    run(sim, 30);
    for (const j of jailers) expect(sim.prison.inside(j.x, j.y)).toBe(true);
  });

  test('повстанец сидит бессрочно, оружие — в изъятом; гражданина в тюрьму не ведут', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && (c.brain as CpBrain).duty === 'squad')!;
    const r = spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_raider', 0), nearGate(sim))!;
    expect(r.weapon).not.toBeNull();
    jail(sim, cp, r);
    expect(r.law.jailUntil).toBe(Infinity);
    expect(r.weapon).toBeNull();
    expect(r.inventory.slots.some((s) => ITEMS[s.id].kind === 'weapon')).toBe(false);
    expect(sim.law.evidence.get(r)?.length ?? 0).toBeGreaterThan(0);
    run(sim, LAW.jailTime.npc + 30);
    expect(r.law.phase).toBe('jailed');
    expect(sim.law.cells[r.law.cell].door?.locked).toBe(true);
    const citizen = sim.entities.list.find((c) => c.faction === 'citizen')!;
    expect(sim.law.freeCell(citizen.x, citizen.y, citizen)?.prison ?? false).toBe(false);
  });

  test('ВС ведёт задержанного повстанца через город в тюрьму', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && (c.brain as CpBrain).duty === 'squad')!;
    const r = spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_raider', 0), { x: cp.x + 20, y: cp.y })!;
    sim.combat.equip(r, null);
    sim.law.arrest(cp, r, 'rebel');
    const b = cp.brain as CpBrain;
    b.target = r;
    b.fsm.change('escort');
    const t = run(sim, 240, () => r.law.phase === 'jailed');
    console.log(`конвой до тюрьмы: ${t.toFixed(0)} с`);
    expect(r.law.phase).toBe('jailed');
    expect(sim.law.cells[r.law.cell].prison).toBe(true);
    // Сперва — приёмная: оформление у стойки, оружие — в изъятое.
    expect(sim.prison.stats.intakes).toBe(1);
    expect(sim.log.some((l) => l.includes('оформлен в приёмной'))).toBe(true);
    expect(sim.law.evidence.get(r)?.length ?? 0).toBeGreaterThan(0);
  });

  test('подполье штурмует тюрьму: свой на свободе вооружается (оружейная, изъятое), уходит к люку', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && (c.brain as CpBrain).duty === 'squad')!;
    const [p1] = sim.insurgency.garrison;
    p1.x = p1.prevX = nearGate(sim).x;
    p1.y = p1.prevY = nearGate(sim).y;
    jail(sim, cp, p1);
    expect(sim.insurgency.prisonReady()).toBe(true);
    clearGuards(sim);
    const op = sim.insurgency.startOperation('prison')!;
    expect(op?.kind).toBe('prison');
    expect(op.team.length).toBeGreaterThanOrEqual(PRISON.assault.team[0]);
    // Спецагенты идут вместе с партизанами.
    expect(op.team.some((c) => c.profession === 'spec_agent')).toBe(true);
    const t = run(sim, 420, () => p1.law.phase === 'none');
    console.log(`штурм тюрьмы подпольем: ${t.toFixed(0)} с, сигнал ${op.group?.attack}`);
    expect(op.group?.attack).toBe(true);
    expect(p1.law.phase).toBe('none');
    expect(sim.prison.stats.freedByUnderground).toBeGreaterThanOrEqual(1);
    // Беглый сперва вооружается: оружейная тюрьмы и своё изъятое.
    run(sim, PRISON.armory.arm + 5, () => !(p1.brain instanceof ArmingBrain));
    expect(sim.prison.stats.armed + sim.prison.stats.fromEvidence).toBeGreaterThanOrEqual(1);
    expect(p1.inventory.slots.some((s) => ITEMS[s.id].kind === 'weapon')).toBe(true);
    run(sim, 2);
    expect(['return', 'stash', 'base']).toContain((p1.brain as UndergroundBrain).mode);
  });

  test('армии на воле мало — волна выручает своих из тюрьмы, потом снова на Управу', { timeout: 180_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    sim.war.reinforcements = false;
    clearGuards(sim);
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && (c.brain as CpBrain).duty === 'squad')!;
    // Остальная армия погибла; пятеро в тюрьме, двое на воле — в городе.
    for (const c of sim.entities.list) if (c.alive && c.brain instanceof RebelBrain) sim.combat.damage(c, 99999, null, null, true);
    const jailed = [0, 1, 2, 3, 4].map((k) => {
      const r = spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_raider', 0), nearGate(sim, k))!;
      jail(sim, cp, r);
      return r;
    });
    const free = [0, 1].map((k) => spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_raider', 0), nearGate(sim, 4 + k))!);
    for (const f of sim.war.fronts) {
      f.held = f.points.length;
      f.owner = 'rebels';
      f.capture = null;
    }
    for (const r of free) {
      sim.war.infiltrators.add(r);
      (r.brain as RebelBrain).storm();
    }
    run(sim, 1);
    expect(sim.war.cityPush).toBe(true);
    expect(sim.prison.rescue).toBe(true);
    const t = run(sim, 240, () => !sim.prison.rescue);
    const out = jailed.filter((r) => r.law.phase !== 'jailed');
    console.log(`выручка из тюрьмы: ${t.toFixed(0)} с, выпущено ${out.length} из ${jailed.length}`);
    expect(sim.prison.stats.freedByArmy).toBeGreaterThanOrEqual(3);
    expect(sim.prison.rescue).toBe(false);
    // Выпущенные — с оружием и в штурме вместе со всеми.
    // Выпущенные сперва вооружаются в оружейной тюрьмы, потом — в штурм.
    run(sim, PRISON.armory.arm + 5, () => out.every((r) => !r.alive || !(r.brain instanceof ArmingBrain)));
    expect(sim.prison.stats.armed + sim.prison.stats.fromEvidence).toBeGreaterThanOrEqual(1);
    const freed = out.filter((r) => r.alive && r.law.phase === 'none');
    expect(freed.length).toBeGreaterThan(0);
    for (const r of freed) {
      expect((r.brain as RebelBrain).mode).toBe('storm');
      expect(r.inventory.slots.some((s) => ITEMS[s.id].kind === 'weapon')).toBe(true);
    }
  });

  test('режимный объект: приёмная, шлюз с решётками, оружейная под замком — пункт склада, площадка с маяками', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const P = sim.prison;
    expect(P.present).toBe(true);
    // Карта годна: мебель тюрьмы не отрезает углов комнат (одна компонента связности).
    expect(validateMap(sim.map)).toEqual([]);
    for (const k of ['armory', 'sally', 'interrogation', 'reception', 'evidence', 'guardroom', 'office', 'yard']) expect(P.rooms.some((r) => r.kind === k)).toBe(true);
    expect(P.racks.length).toBeGreaterThanOrEqual(6);
    expect(P.shelves.length).toBeGreaterThanOrEqual(4);
    expect(P.stock.guns).toBe(PRISON.armory.guns.start);
    // Оружейная — пункт боепитания склада (конвои возят туда), под замком.
    expect(sim.arsenal.pointOf(-2)).toBe(P.stock);
    expect(sim.arsenal.nexusPoint).not.toBe(P.stock);
    expect(P.armoryLocked).toBe(true);
    expect(P.armoryDoor?.locked).toBe(true);
    expect(P.inside(P.armorySpot!.x, P.armorySpot!.y)).toBe(true);
    // Шлюз: две решётки (сквозь них видно).
    expect(P.sallyDoors).toHaveLength(2);
    for (const d of P.sallyDoors) for (const i of d.tiles) expect(sim.map.grate[i]).toBe(1);
    // Приёмная: место задержанного у стойки, дежурный — первый пост.
    expect(P.intakeSpot && P.inside(P.intakeSpot.x, P.intakeSpot.y)).toBe(true);
    expect(P.counter.length).toBeGreaterThanOrEqual(2);
    expect(P.posts[0].kind).toBe('desk');
    expect(P.posts.filter((p) => p.kind === 'block')).toHaveLength(2);
    expect(P.posts.filter((p) => p.kind === 'yard')).toHaveLength(4);
    // Площадка для корабля: маяки, мачты, места сброса — во дворе.
    expect(P.beacons).toHaveLength(2);
    expect(P.masts).toHaveLength(4);
    expect(P.drops).toHaveLength(4);
    const pad = P.padRect!;
    expect(P.pad!.x > pad.x && P.pad!.x < pad.x + pad.w && P.pad!.y > pad.y && P.pad!.y < pad.y + pad.h).toBe(true);
    expect(P.cots.length + P.lockers.length + P.itable.length + P.benches.length).toBeGreaterThan(6);
    spawnPopulation(sim.ctx, 10);
    const desk = duty(sim, 'jailer').find((j) => (j.brain as CpBrain).guardPost && Math.hypot((j.brain as CpBrain).guardPost!.x - P.posts[0].x, (j.brain as CpBrain).guardPost!.y - P.posts[0].y) < 1);
    expect(desk).toBeTruthy();
  });

  test('беглый выбивает запертую оружейную, берёт ствол, магазины и гранату, потом своё из изъятого', { timeout: 90_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    clearGuards(sim);
    const P = sim.prison;
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && (c.brain as CpBrain).duty === 'squad')!;
    const r = spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_raider', 0), nearGate(sim))!;
    jail(sim, cp, r);
    expect(sim.law.evidence.has(r)).toBe(true);
    const guns0 = P.stock.guns;
    const kits0 = P.stock.kits;
    const gren0 = P.stock.grenades;
    sim.law.breakCell(sim.law.cells[r.law.cell]);
    expect(r.law.phase).toBe('none');
    expect(r.brain).toBeInstanceOf(ArmingBrain);
    const t = run(sim, PRISON.armory.arm + 5, () => !(r.brain instanceof ArmingBrain));
    console.log(`беглый вооружился: ${t.toFixed(0)} с`);
    expect(P.stats.armoryBroken).toBe(1);
    expect(P.stats.armed).toBe(1);
    expect(P.stock.guns).toBe(guns0 - 1);
    expect(P.stock.kits).toBe(kits0 - 1);
    expect(P.stock.grenades).toBeLessThan(gren0);
    expect(r.inventory.slots.some((s) => ITEMS[s.id].kind === 'weapon')).toBe(true);
    expect(r.weapon).not.toBeNull();
    // Изъятое — по пути, забрал своё.
    expect(sim.law.evidence.has(r)).toBe(false);
    expect(r.brain).toBeInstanceOf(RebelBrain);
    expect(sim.log.some((l) => l.includes('дверь оружейной выбита'))).toBe(true);
  });

  test('оружейную тюрьмы пополняет конвой склада: ящики патронов и стволы со стоек', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const A = sim.arsenal;
    const P = sim.prison;
    const cpSpec = (kind: RoleSpec['kind'], unit: CpUnitId, extra: Partial<RoleSpec> = {}): RoleSpec => {
      const rank = CP_UNIT[unit];
      return { kind, faction: 'cp', profession: null, division: cpUnit(rank).group, rank, kit: cpUnit(rank).kit, ...extra };
    };
    [0, 1, 2, 3].forEach((k) => {
      const post = A.crewSpots[k % A.crewSpots.length];
      spawnRole(sim.ctx, cpSpec('convoy', 'su3', { post, facing: 0 }), post);
    });
    // Остальные пункты полны — конвой идёт в тюрьму.
    for (const p of A.points) if (p !== P.stock) {
      p.kits = p.cap;
      p.grenades = p.grenadesCap;
    }
    P.stock.guns = 0;
    P.stock.kits = 2;
    const racks0 = A.slots.filter((s) => s.area === 'rack' && s.crate && !s.crate.broken).length;
    run(sim, ARSENAL.convoy.dispatchEvery + 1);
    expect(A.convoys).toHaveLength(1);
    const v = A.convoys[0];
    expect(v.point).toBe(P.stock);
    expect([...v.loads.values()].some((l) => l.kind === 'gun')).toBe(true);
    const t = run(sim, 400, () => A.stats.convoysDone > 0 || A.convoys.length === 0);
    console.log(`конвой в тюрьму: ${t.toFixed(0)} с, стволов ${P.stock.guns}, комплектов ${P.stock.kits}`);
    expect(A.stats.convoysDone).toBe(1);
    expect(P.stock.guns).toBeGreaterThan(0);
    expect(P.stock.kits).toBeGreaterThan(2);
    expect(A.slots.filter((s) => s.area === 'rack' && s.crate && !s.crate.broken).length).toBeLessThan(racks0);
    // Отошли — оружейная снова заперта.
    run(sim, 20);
    expect(P.armoryLocked).toBe(true);
  });

  test('охрана тюрьмы пополняет патроны в своей оружейной', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const P = sim.prison;
    const j = duty(sim, 'jailer').find((c) => sim.ctx.combat.weaponsOf(c).some((id) => !!WEAPONS[id].ammo))!;
    for (const id of sim.ctx.combat.weaponsOf(j)) {
      const w = WEAPONS[id];
      if (w.ammo) j.inventory.remove(AMMO_ITEM[w.ammo], j.inventory.count(AMMO_ITEM[w.ammo]));
    }
    expect(P.needsStock(j)).toBe(true);
    const k0 = P.stock.kits;
    const t = run(sim, 120, () => P.stock.kits < k0);
    console.log(`охранник в оружейной: ${t.toFixed(0)} с`);
    expect(P.stock.kits).toBe(k0 - 1);
    expect(P.needsStock(j)).toBe(false);
  });
});
