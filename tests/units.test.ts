import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit, poiWorld } from '../src/systems/Population';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { FIRE } from '../src/config/combat';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, secs: number, until?: () => boolean): number {
  for (let t = 0; t < secs * 60; t++) {
    sim.step();
    if (until?.()) return t / 60;
  }
  return secs;
}

function calm(sim: Sim): void {
  sim.war.command.paused = true;
  sim.insurgency.paused = true;
}

/** Проходимая точка у площади со смещением. */
function spot(sim: Sim, dx: number, dy = 0): { x: number; y: number } {
  const p = poiWorld(sim.ctx, 'plaza_center')!;
  const a = sim.nav.nearestWalkable(p.x + dx, p.y + dy, 6);
  return { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
}

describe('спецподразделения ГО и огонь', () => {
  test('OBS осматривает тело и объявляет убийцу в розыск', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    const at = spot(sim, 0);
    const victim = createCharacter(sim.entities, sim.ctx.rng, 'citizen', at.x, at.y);
    const k = spot(sim, 200);
    const killer = createCharacter(sim.entities, sim.ctx.rng, 'citizen', k.x, k.y);
    sim.combat.kill(victim, killer);
    const corpse = sim.combat.corpses[sim.combat.corpses.length - 1];
    expect(corpse.killer).toBe(killer);
    const o = spot(sim, -80);
    const obs = createCharacter(sim.entities, sim.ctx.rng, 'cp', o.x, o.y);
    equipKit(obs, 'cp', sim.ctx);
    obs.division = 'jury';
    obs.brain = new CpBrain(obs, sim.ctx);
    run(sim, 40, () => !!corpse.scanned);
    expect(corpse.scanned).toBe(true);
    expect(killer.law.wanted).toBe(true);
  });

  test('сканер TECH засекает вооружённого — тревога', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    const at = spot(sim, 0);
    const tech = createCharacter(sim.entities, sim.ctx.rng, 'cp', at.x, at.y);
    tech.division = 'tech';
    expect(sim.scanners.deploy(tech)).toBeNull();
    expect(sim.scanners.deploy(tech)).toMatch(/уже/);
    const b = spot(sim, 30, 20);
    const armed = createCharacter(sim.entities, sim.ctx.rng, 'citizen', b.x, b.y);
    equipKit(armed, 'rebel_raider', sim.ctx);
    run(sim, 5, () => sim.scanners.stats.spotted > 0);
    expect(sim.scanners.stats.spotted).toBeGreaterThan(0);
    expect(sim.war.code).not.toBe('green');
    expect(sim.war.operatives.has(armed)).toBe(true);
  });

  test('огонь: горящий получает урон, после горения — перестаёт', () => {
    const sim = makeSim(12345);
    const at = spot(sim, 0);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', at.x, at.y);
    sim.combat.ignite(c, null, 2);
    for (let k = 0; k < 60; k++) sim.combat.update(1 / 30);
    const hp = c.health;
    expect(hp).toBeLessThan(100);
    expect(hp).toBeGreaterThan(100 - FIRE.dps * 2 - 1);
    for (let k = 0; k < 60; k++) sim.combat.update(1 / 30);
    expect(c.health).toBe(hp);
  });

  test('крематор сжигает тела в городе', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    run(sim, 1);
    expect(sim.labor.cremator?.alive).toBe(true);
    const cr = sim.labor.cremator!;
    const a = sim.nav.nearestWalkable(cr.x + 120, cr.y, 8);
    const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', sim.nav.worldX(a), sim.nav.worldY(a));
    sim.combat.kill(v, null);
    const corpse = sim.combat.corpses[sim.combat.corpses.length - 1];
    run(sim, 90, () => !sim.combat.corpses.includes(corpse));
    expect(sim.combat.corpses.includes(corpse)).toBe(false);
  });
});
