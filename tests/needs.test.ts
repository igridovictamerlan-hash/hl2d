import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { spawnPopulation } from '../src/systems/Population';
import { ECONOMY } from '../src/config/economy';
import { GANGS } from '../src/config/gangs';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, secs: number, until?: () => boolean): number {
  for (let t = 0; t < secs * 60; t++) {
    sim.step();
    if (until?.()) return t / 60;
  }
  return secs;
}

/** Еда есть у каждой стороны: раньше ели только горожане, остальные голодали до «лечебной» смерти. */
describe('голод и еда', () => {
  test('довольствие: ВС без еды получает паёк; рабочий ТС — только если работал', () => {
    const sim = makeSim(12345);
    const p = sim.nav.walkable[200];
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', sim.nav.worldX(p), sim.nav.worldY(p));
    const idle = createCharacter(sim.entities, sim.ctx.rng, 'cwu', sim.nav.worldX(p), sim.nav.worldY(p));
    const worker = createCharacter(sim.entities, sim.ctx.rng, 'cwu', sim.nav.worldX(p), sim.nav.worldY(p));
    for (const c of [cp, idle, worker]) {
      c.inventory.clear();
      c.hunger = ECONOMY.meals.below - 5;
    }
    sim.economy.markWorked(worker);
    sim.economy.update(ECONOMY.salary.interval + 0.1);
    expect(sim.economy.hasFood(cp) || cp.hunger > ECONOMY.meals.below).toBe(true);
    expect(sim.economy.hasFood(worker) || worker.hunger > ECONOMY.meals.below).toBe(true);
    expect(sim.economy.hasFood(idle)).toBe(false);
  });

  test('котёл лагеря кормит армию, общак — банду', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 20);
    const soldier = sim.war.command.army.find((c) => c.brain instanceof RebelBrain && c.brain.mode === 'camp')!;
    expect(soldier).toBeTruthy();
    soldier.hunger = 5;
    run(sim, 6);
    expect(soldier.hunger).toBeGreaterThan(5 + ECONOMY.meals.camp * 4);
    const g = sim.ctx.gangs.gangs[0];
    const m = sim.ctx.gangs.members(g)[0];
    m.x = m.prevX = g.hq.x;
    m.y = m.prevY = g.hq.y;
    m.inventory.clear();
    m.hunger = 10;
    g.bank = 100;
    run(sim, 3);
    expect(m.hunger).toBeGreaterThan(10);
    expect(g.bank).toBeLessThanOrEqual(100 - GANGS.meal.cost);
  });

  test('голодный горожанин без еды бросает досуг и ищет еду: суп в столовой, паёк или хлеб', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.ctx.gangs.paused = true;
    sim.insurgency.paused = true;
    spawnPopulation(sim.ctx, 20);
    const c = sim.entities.list.find((o) => o.faction === 'citizen' && o.alive && o.gang < 0 && o.profession === 'citizen' && o.law.phase === 'none' && o.brain instanceof CitizenBrain)!;
    c.inventory.clear();
    c.hunger = 5;
    // Плановая проверка CID (приказ «стоять») не должна совпасть с этими двумя секундами: тест про голод, не про закон.
    c.law.lastCheck = sim.law.now;
    run(sim, 2);
    expect(['canteen', 'queue', 'shop']).toContain((c.brain as CitizenBrain).fsm.current);
    run(sim, 90, () => c.hunger > 30);
    expect(c.hunger).toBeGreaterThan(30);
  });
});
