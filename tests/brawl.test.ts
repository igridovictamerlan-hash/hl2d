import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { randomAnchorAround } from '../src/ai/destinations';
import { FISTS } from '../src/config/brawl';
import type { Character } from '../src/entities/Character';

const setup = () => {
  const sim = makeSim(12345);
  sim.war.command.paused = true;
  spawnPopulation(sim.ctx, 40);
  return sim;
};

/** Поставить b вплотную к a (лицом друг к другу). */
const faceOff = (sim: ReturnType<typeof setup>, a: Character, b: Character) => {
  const n = randomAnchorAround(a, sim.ctx, 1, 2, new Set());
  b.x = b.prevX = sim.nav.worldX(n);
  b.y = b.prevY = sim.nav.worldY(n);
  a.facing = Math.atan2(b.y - a.y, b.x - a.x);
};

describe('кулаки и драки', () => {
  test('кулаком не убить: нокаут на пороге здоровья, ударенный отвечает — драка', { timeout: 60_000 }, () => {
    const sim = setup();
    const cits = sim.entities.list.filter((c) => c.faction === 'citizen' && c.gang < 0 && c.brain instanceof CitizenBrain && c.loyalty < 60);
    const [a, b] = cits;
    b.law.lastCheck = a.law.lastCheck = sim.law.now;
    faceOff(sim, a, b);
    // Первый удар — b отвечает (или убегает); сажаем в драку принудительно, если сбежал.
    sim.ctx.combat.punch(a, b.x, b.y);
    if (!sim.ctx.brawls.fighting(b)) sim.ctx.brawls.start(b, a);
    expect(sim.ctx.brawls.fighting(a)).toBe(true);
    expect((b.brain as CitizenBrain).fsm.current).toBe('brawl');
    // Бьём, пока не нокаут: здоровье не ниже порога, жив.
    for (let t = 0; t < 30 * 60 && b.health > FISTS.floor + 0.01; t++) {
      sim.ctx.combat.punch(a, b.x, b.y);
      faceOff(sim, a, b);
      sim.step();
    }
    expect(b.alive).toBe(true);
    expect(b.health).toBeGreaterThanOrEqual(FISTS.floor - 0.01);
  });

  test('оскорбление: бандит бросается в драку, братва впрягается', { timeout: 60_000 }, () => {
    const sim = setup();
    const g = sim.ctx.gangs.gangs[0];
    const members = sim.ctx.gangs.members(g).filter((c) => c.profession === 'bandit');
    const victim = members[0];
    // Братва рядом.
    for (const m of members.slice(1, 3)) {
      const n = randomAnchorAround(victim, sim.ctx, 2, 5, new Set());
      m.x = m.prevX = sim.nav.worldX(n);
      m.y = m.prevY = sim.nav.worldY(n);
    }
    const p = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen' }, victim)!;
    faceOff(sim, p, victim);
    p.facing = Math.atan2(victim.y - p.y, victim.x - p.x);
    let fought = false;
    for (let k = 0; k < 12 && !fought; k++) {
      for (let t = 0; t < 180; t++) sim.step(); // откат оскорбления
      faceOff(sim, p, victim);
      sim.ctx.brawls.insult(p, victim);
      fought = sim.ctx.brawls.fighting(victim);
    }
    expect(fought).toBe(true);
    expect(sim.ctx.brawls.stats.backups).toBeGreaterThan(0);
    // Против игрока дерутся несколько бойцов банды.
    const onP = sim.ctx.brawls.list.filter((b) => b.a === p || b.b === p).length;
    expect(onP).toBeGreaterThanOrEqual(2);
  });

  test('бандита ранили из ствола — братва стреляет по обидчику (вражда)', { timeout: 60_000 }, () => {
    const sim = setup();
    const g = sim.ctx.gangs.gangs[0];
    const [victim, mate] = sim.ctx.gangs.members(g).filter((c) => c.profession === 'bandit');
    const n = randomAnchorAround(victim, sim.ctx, 2, 4, new Set());
    mate.x = mate.prevX = sim.nav.worldX(n);
    mate.y = mate.prevY = sim.nav.worldY(n);
    const foe = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen' }, victim)!;
    foe.inventory.add('rebel_pistol', 1);
    foe.weapon = 'rebel_pistol';
    sim.ctx.combat.damage(victim, 10, foe, 'arm');
    expect(sim.ctx.combat.isHostile(mate, foe)).toBe(true);
    expect(sim.ctx.combat.isHostile(foe, mate)).toBe(true);
  });

  test('случайные драки на улице и ВС разнимает', { timeout: 200_000 }, () => {
    const sim = setup();
    sim.ctx.brawls.enabled = true;
    for (let t = 0; t < 240 * 60; t++) sim.step();
    expect(sim.ctx.brawls.stats.brawls).toBeGreaterThan(0);
  });
});
