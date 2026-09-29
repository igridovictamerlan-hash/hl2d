import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation, armySpec } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { UndergroundBrain } from '../src/ai/brains/UndergroundBrain';
import { CP_UNIT } from '../src/config/factions';
import { ITEMS } from '../src/config/items';
import { LAW } from '../src/config/law';
import { PRISON } from '../src/config/prison';
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

/** Снять охрану тюрьмы (проверяется сам штурм, а не исход боя). */
function clearGuards(sim: Sim): void {
  for (const c of [...duty(sim, 'jailer'), ...duty(sim, 'warden')]) sim.combat.damage(c, 99999, null, null, true);
}

describe('тюрьма Альянса', () => {
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
    expect(sim.prison.posts).toHaveLength(6);
    for (const p of sim.prison.posts) expect(sim.prison.inside(p.x, p.y)).toBe(true);
    const jailers = duty(sim, 'jailer');
    expect(jailers).toHaveLength(PRISON.guards);
    for (const j of jailers) expect(j.rank).toBe(CP_UNIT.guard);
    const warden = duty(sim, 'warden');
    expect(warden).toHaveLength(1);
    // Третий инспектор: два в штабе и начальник тюрьмы.
    expect(sim.entities.list.filter((c) => c.faction === 'cp' && c.rank === CP_UNIT.insp)).toHaveLength(3);
    // Тюрьма — отдельно от Нексуса.
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

  test('ГО ведёт задержанного повстанца через город в тюрьму', { timeout: 120_000 }, () => {
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
  });

  test('подполье штурмует тюрьму: свой на свободе с оружием из изъятого, уходит к люку', { timeout: 120_000 }, () => {
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
    expect(p1.inventory.slots.some((s) => ITEMS[s.id].kind === 'weapon')).toBe(true);
    run(sim, 2);
    expect(['return', 'stash', 'base']).toContain((p1.brain as UndergroundBrain).mode);
  });

  test('армии на воле мало — волна выручает своих из тюрьмы, потом снова на Нексус', { timeout: 180_000 }, () => {
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
    const freed = out.filter((r) => r.alive);
    expect(freed.length).toBeGreaterThan(0);
    for (const r of freed) {
      expect((r.brain as RebelBrain).mode).toBe('storm');
      expect(r.inventory.slots.some((s) => ITEMS[s.id].kind === 'weapon')).toBe(true);
    }
  });
});
