import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit } from '../src/systems/Population';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { WAR } from '../src/config/war';
import { PrisonerBrain } from '../src/ai/brains/PrisonerBrain';

type Sim = ReturnType<typeof makeSim>;

/** Убийство a → b в коридоре КПП фронта f. */
function killInCorridor(sim: Sim, f: Sim['war']['fronts'][number], killerFaction: 'rebel' | 'cp') {
  const a = f.corridor[Math.floor(f.corridor.length / 2)];
  const x = sim.nav.worldX(a);
  const y = sim.nav.worldY(a);
  const killer = createCharacter(sim.entities, sim.ctx.rng, killerFaction, x, y);
  const victim = createCharacter(sim.entities, sim.ctx.rng, killerFaction === 'rebel' ? 'cp' : 'rebel', x + 4, y);
  sim.combat.damage(victim, 1000, killer);
  killer.alive = false;
  sim.entities.remove(killer);
}

describe('капт КПП', () => {
  test('5 повстанцев у КПП начинают капт', () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    f.nextCaptureAt = 0;
    f.nextSquadAt = f.nextWaveAt = Infinity;
    for (let k = 0; k < WAR.capture.minAttackers; k++) {
      const a = f.outlands[k * 3];
      const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
      equipKit(r, 'rebel_raider', sim.ctx);
      r.brain = new RebelBrain(r, sim.ctx, 0, Infinity);
      f.squad.push(r);
    }
    sim.step();
    expect(f.capture).not.toBeNull();
    expect(f.squad.every((r) => (r.brain as RebelBrain).mode === 'capture')).toBe(true);
  });

  test('повстанцы набрали убийства с перевесом — КПП захвачен, красный код; зона очищена — отбит', () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    f.nextSquadAt = f.nextWaveAt = Infinity;
    sim.war.startCapture(f);
    killInCorridor(sim, f, 'cp');
    for (let k = 0; k < WAR.capture.killsToWin - 1; k++) killInCorridor(sim, f, 'rebel');
    expect(f.owner).toBe('combine');
    expect(f.capture!.rebelKills).toBe(WAR.capture.killsToWin - 1);
    expect(f.capture!.cpKills).toBe(1);
    killInCorridor(sim, f, 'rebel');
    expect(f.owner).toBe('rebels');
    expect(f.capture).toBeNull();
    sim.step();
    expect(sim.war.code).toBe('red');
    // Повстанцев в КПП нет — после holdTime и retakeCalm КПП снова у Альянса.
    for (const c of sim.entities.list) if (c.faction === 'rebel') c.alive = false;
    for (let t = 0; t < (WAR.capture.holdTime + WAR.capture.retakeCalm + 2) * 60 && f.owner === 'rebels'; t++) sim.step();
    expect(f.owner).toBe('combine');
  });

  test('по таймеру без перевеса — КПП удержан, следующий капт не раньше cooldown', () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[1];
    f.nextSquadAt = f.nextWaveAt = Infinity;
    sim.war.startCapture(f);
    for (let k = 0; k < WAR.capture.minKills; k++) killInCorridor(sim, f, 'rebel');
    for (let k = 0; k < WAR.capture.minKills; k++) killInCorridor(sim, f, 'cp');
    for (let t = 0; t < (WAR.capture.duration + 1) * 60 && f.capture; t++) sim.step();
    expect(f.capture).toBeNull();
    expect(f.owner).toBe('combine');
    expect(f.nextCaptureAt).toBeGreaterThan(sim.war.now + WAR.capture.cooldown - 5);
  });

  test('задержанный боец отряда (мозг конвоя) не ломает захват КПП', () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    f.nextSquadAt = f.nextWaveAt = Infinity;
    const a = f.outlands[0];
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
    r.brain = new PrisonerBrain(r);
    f.squad.push(r);
    expect(() => {
      sim.war.startCapture(f);
      for (let k = 0; k < WAR.capture.killsToWin; k++) killInCorridor(sim, f, 'rebel');
    }).not.toThrow();
    expect(f.owner).toBe('rebels');
  });
});
