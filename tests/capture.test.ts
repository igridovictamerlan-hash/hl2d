import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit } from '../src/systems/Population';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { WAR } from '../src/config/war';
import { PrisonerBrain } from '../src/ai/brains/PrisonerBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { DefectorBrain } from '../src/ai/brains/DefectorBrain';
import { spawnPopulation, poiWorld } from '../src/systems/Population';

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
    f.nextSquadAt = Infinity;
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

  test('тамбур: точки берутся по очереди (D3, потом D4), код жёлтый; контрудар из Цитадели отбивает обе', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    f.nextSquadAt = Infinity;
    expect(f.points.map((p) => p.name)).toEqual(['D3', 'D4']);
    sim.war.startCapture(f);
    expect(f.capture!.point).toBe(0);
    killInCorridor(sim, f, 'cp');
    for (let k = 0; k < WAR.capture.killsToWin - 1; k++) killInCorridor(sim, f, 'rebel');
    expect(f.held).toBe(0);
    expect(f.capture!.rebelKills).toBe(WAR.capture.killsToWin - 1);
    expect(f.capture!.cpKills).toBe(1);
    killInCorridor(sim, f, 'rebel');
    expect(f.held).toBe(1);
    expect(f.owner).toBe('combine');
    expect(f.capture).toBeNull();
    sim.step();
    expect(sim.war.code).toBe('yellow');
    // Вторая точка — D4: КПП прорван.
    sim.war.startCapture(f);
    expect(f.capture!.point).toBe(1);
    for (let k = 0; k < WAR.capture.killsToWin; k++) killInCorridor(sim, f, 'rebel');
    expect(f.held).toBe(2);
    expect(f.owner).toBe('rebels');
    // Повстанцев нет — контрудары из Цитадели занимают точки и отбивают КПП (сначала D4, потом D3).
    for (const c of sim.entities.list) if (c.faction === 'rebel') c.alive = false;
    const cpBefore = sim.entities.list.filter((c) => c.alive && (c.faction === 'cp' || c.faction === 'ota')).length;
    const held: number[] = [];
    for (let t = 0; t < 240 * 60 && f.held > 0; t++) {
      sim.step();
      if (held[held.length - 1] !== f.held) held.push(f.held);
    }
    expect(held).toEqual([2, 1, 0]);
    expect(f.owner).toBe('combine');
    expect(sim.war.stats.counterattacks).toBeGreaterThan(0);
    expect(sim.entities.list.filter((c) => c.alive && c.faction === 'ota').length + cpBefore).toBeGreaterThan(cpBefore);
  });

  test('по таймеру без перевеса — КПП удержан, следующий капт не раньше cooldown', () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[1];
    f.nextSquadAt = Infinity;
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
    f.nextSquadAt = Infinity;
    const a = f.outlands[0];
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
    r.brain = new PrisonerBrain(r);
    f.squad.push(r);
    expect(() => {
      sim.war.startCapture(f);
      for (let k = 0; k < WAR.capture.killsToWin; k++) killInCorridor(sim, f, 'rebel');
    }).not.toThrow();
    expect(f.held).toBe(1);
  });

  test('капт: гарнизон точки перебит — точка захвачена; подкрепления ГО во время капта не приходят', () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    f.nextSquadAt = Infinity;
    // Гарнизон подтянулся.
    for (let t = 0; t < 40 * 60; t++) sim.step();
    const cps = () => sim.entities.list.filter((c) => c.alive && c.faction === 'cp' && sim.war.frontAt(c.x, c.y) === f).length;
    expect(cps()).toBeGreaterThan(0);
    for (let k = 0; k < WAR.capture.minAttackers; k++) {
      const a = f.outlands[k * 3];
      const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
      equipKit(r, 'rebel_raider', sim.ctx);
      r.brain = new RebelBrain(r, sim.ctx, 0, Infinity);
      f.squad.push(r);
    }
    sim.war.startCapture(f);
    expect(f.capture!.defenders.length).toBeGreaterThan(0);
    // Убиваем гарнизон без стрельбы — и ждём: новых ГО на КПП быть не должно.
    // Гарнизон D3 — часовые двух постов внешней камеры.
    expect(f.capture!.defenders.every((d) => sim.war.pointOfPost(f, (d.brain as CpBrain).guardPost!) === 0)).toBe(true);
    for (const d of f.capture!.defenders) sim.combat.damage(d, 1000, null);
    for (let t = 0; t < 30 && f.capture; t++) sim.step();
    expect(f.held).toBe(1);
  });

  test('штурмующих не осталось — капт отбит, повстанцы снова собираются', () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    f.nextSquadAt = Infinity;
    const a = f.outlands[0];
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
    r.brain = new RebelBrain(r, sim.ctx, 0, Infinity);
    f.squad.push(r);
    sim.war.startCapture(f);
    const reinforcements = sim.entities.list.filter((c) => c.faction === 'cp').length;
    sim.combat.damage(r, 1000, null);
    for (let t = 0; t < 4 * 60 && f.capture; t++) sim.step();
    expect(f.capture).toBeNull();
    expect(f.owner).toBe('combine');
    expect(reinforcements).toBe(0);
  });

  test('подкрепления ГО выходят из Цитадели и бегут на свои посты', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const f = sim.war.fronts[0];
    f.nextSquadAt = Infinity;
    sim.war.fronts[1].nextSquadAt = Infinity;
    const gate = poiWorld(sim.ctx, 'nexus_gate')!;
    // Гарнизона нет — через reinforceDelay выходит часовой.
    for (let t = 0; t < (WAR.reinforceDelay + 1) * 60; t++) sim.step();
    const g = sim.entities.list.find((c) => c.brain instanceof CpBrain && c.brain.front === 0 && c.brain.guardPost)!;
    expect(g).toBeTruthy();
    expect(Math.hypot(g.x - gate.x, g.y - gate.y)).toBeLessThan(200);
    const post = (g.brain as CpBrain).guardPost!;
    for (let t = 0; t < 90 * 60 && Math.hypot(g.x - post.x, g.y - post.y) > 30; t++) sim.step();
    expect(Math.hypot(g.x - post.x, g.y - post.y)).toBeLessThan(30);
  });

  test('КПП прорван — граждане бегут туда и становятся повстанцами', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    for (const o of sim.war.fronts) o.nextSquadAt = Infinity;
    sim.insurgency.paused = true;
    const f = sim.war.fronts[0];
    sim.war.breach(f);
    f.heldSince = sim.war.now;
    f.retakeAt = Infinity;
    for (let t = 0; t < 150 * 60 && sim.war.stats.defected === 0; t++) sim.step();
    console.log(`бегут: ${sim.war.defectors.size}, перешли: ${sim.war.stats.defected}`);
    expect(sim.war.stats.defected).toBeGreaterThan(0);
    const turned = f.squad.find((r) => r.profession === 'rebel_soldier' && r.faction === 'rebel')!;
    expect(turned).toBeTruthy();
    expect(turned.weapon).not.toBeNull();
    // КПП отбит — бегущие возвращаются к обычной жизни.
    f.held = 0;
    f.owner = 'combine';
    sim.step();
    expect([...sim.entities.list].some((c) => c.brain instanceof DefectorBrain)).toBe(false);
    expect(sim.entities.list.some((c) => c.faction === 'citizen' && c.brain instanceof CitizenBrain)).toBe(true);
  });

  test('все точки D у повстанцев — они выходят в город (красный код)', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    for (const f of sim.war.fronts) {
      f.nextSquadAt = Infinity;
      f.retakeAt = Infinity;
      for (let k = 0; k < 4; k++) {
        const a = f.corridor[Math.floor(f.corridor.length * (0.3 + k * 0.15))];
        const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
        equipKit(r, 'rebel_raider', sim.ctx);
        const b = new RebelBrain(r, sim.ctx, f.index, Infinity);
        r.brain = b;
        b.orderHold(f.posts[k % f.posts.length]);
        f.squad.push(r);
      }
    }
    // Одна точка ещё у Альянса — в город никто не идёт.
    sim.war.fronts[0].held = 2;
    sim.war.fronts[0].owner = 'rebels';
    sim.war.fronts[1].held = 1;
    sim.step();
    expect(sim.war.cityPush).toBe(false);
    sim.war.fronts[1].held = 2;
    sim.war.fronts[1].owner = 'rebels';
    sim.step();
    expect(sim.war.cityPush).toBe(true);
    for (const f of sim.war.fronts) {
      const modes = f.squad.map((r) => (r.brain as RebelBrain).mode);
      expect(modes.filter((m) => m === 'hold').length).toBe(WAR.holdKeep);
      expect(modes.filter((m) => m === 'assault').length).toBe(2);
    }
    for (let t = 0; t < 60 * 60 && sim.war.code !== 'red'; t++) sim.step();
    expect(sim.war.code).toBe('red');
  });
});
