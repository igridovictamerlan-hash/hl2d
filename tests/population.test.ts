import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { AStar } from '../src/ai/AStar';
import { LOD } from '../src/config/population';
import { AI } from '../src/config/ai';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

/** Сколько живых по признаку. */
function count(sim: Sim, f: (c: Character) => boolean): number {
  return sim.entities.list.filter((c) => c.alive && !c.isPlayer && f(c)).length;
}

/**
 * Население (config/population.ts): множитель городских ролей и упрощённая симуляция вдали от игрока.
 */
describe('население', () => {
  test('множитель: городских ролей больше, война — прежняя; при 1 — ровно как в конфиге', { timeout: 120_000 }, () => {
    const one = makeSim(12345);
    spawnPopulation(one.ctx, 40, 1);
    const two = makeSim(12345);
    spawnPopulation(two.ctx, 80, 2);
    const cwu = (s: Sim) => count(s, (c) => c.faction === 'cwu' && c.profession !== 'vendor' && c.profession !== 'canteen_cook');
    const vort = (s: Sim) => count(s, (c) => c.faction === 'vort');
    const patrol = (s: Sim) => count(s, (c) => c.faction === 'cp' && (c.role?.kind === 'squad' || c.role?.kind === 'tech'));
    const gang = (s: Sim) => count(s, (c) => c.gang !== null && c.gang !== undefined && c.profession === 'bandit');
    const war = (s: Sim) => count(s, (c) => c.faction === 'ota' || (c.faction === 'cp' && (c.role?.kind === 'guard' || c.role?.kind === 'medic')) || (c.faction === 'rebel' && c.role?.kind !== 'citizen'));
    // При 1 — состав из конфига (тесты и старые замеры не сдвигаются).
    expect(vort(one)).toBe(AI.population.vorts);
    expect(cwu(one)).toBe(AI.population.cwuProfessions.length + 1); // + глава ТС
    // При 2 — городских ролей вдвое (каждой профессии ТС — не меньше одной), война та же.
    expect(vort(two)).toBe(AI.population.vorts * 2);
    expect(cwu(two)).toBeGreaterThanOrEqual(2 * AI.population.cwuProfessions.length);
    expect(patrol(two)).toBeGreaterThan(patrol(one) * 1.6);
    expect(gang(two)).toBeGreaterThan(gang(one) * 1.6);
    expect(war(two)).toBe(war(one));
    expect(two.labor.crematorCount).toBe(one.labor.crematorCount * 2);
    expect(two.cwuHq.maxWorkers).toBe(one.cwuHq.maxWorkers * 2);
    // Меньше 1 — у каждой профессии ТС хоть один.
    const small = makeSim(12345);
    spawnPopulation(small.ctx, 20, 0.3);
    const profs = new Set(small.entities.list.filter((c) => c.faction === 'cwu').map((c) => c.profession));
    for (const p of AI.population.cwuProfessions) expect(profs.has(p), p).toBe(true);
  });

  test('упрощённая симуляция: дальний думает реже, занятый и видимый — каждый тик; без фокуса — все каждый тик', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 60, 1);
    const pc = sim.ctx.map.poisOf('plaza_center')[0];
    const ts = sim.ctx.map.tileSize;
    const fx = (pc.x + 0.5) * ts;
    const fy = (pc.y + 0.5) * ts;
    // Счётчик решений мозга у каждого.
    const calls = new Map<Character, number>();
    for (const c of sim.entities.list) {
      const b = c.brain;
      if (!b) continue;
      const orig = b.update.bind(b);
      b.update = (self, ctx, dt) => {
        calls.set(self, (calls.get(self) ?? 0) + 1);
        orig(self, ctx, dt);
      };
    }
    for (const c of sim.entities.list) c.visible = false;
    sim.ctx.lod = { x: fx, y: fy, r2: LOD.radius ** 2, farR2: (LOD.radius * LOD.farMul) ** 2, every: LOD.every, farEvery: LOD.farEvery, tick: 0 };
    // Дальнего пометим занятым боем — он думает каждый тик.
    const far = sim.entities.list.filter((c) => c.brain && Math.hypot(c.x - fx, c.y - fy) > LOD.radius * LOD.farMul + 400);
    expect(far.length).toBeGreaterThan(10);
    const fighter = far[0];
    const ticks = 240;
    for (let t = 0; t < ticks; t++) {
      fighter.engagedUntil = sim.combat.now + 5;
      for (const c of sim.entities.list) c.visible = false;
      sim.step();
    }
    expect(calls.get(fighter)).toBe(ticks);
    const lazy = far.slice(1).filter((c) => c.alive && c.lodFar);
    expect(lazy.length).toBeGreaterThan(5);
    // Дальние думают не чаще раза в every тиков (совсем далеко — ещё реже; ± один из-за такта по id).
    for (const c of lazy.slice(0, 8)) expect(calls.get(c) ?? 0).toBeLessThanOrEqual(Math.ceil(ticks / LOD.every) + 1);
    // Ближние (у площади) — каждый тик.
    const nearby = sim.entities.list.filter((c) => c.brain && c.alive && Math.hypot(c.x - fx, c.y - fy) < LOD.radius * 0.5 && !c.lodFar);
    expect(nearby.length).toBeGreaterThan(0);
    for (const c of nearby.slice(0, 5)) expect(calls.get(c)).toBeGreaterThan(ticks * 0.9);
    // Без фокуса (тесты, учения) — никто не дальний.
    sim.ctx.lod = null;
    sim.step();
    expect(sim.entities.list.some((c) => c.lodFar)).toBe(false);
  });

  test('«жадный» A* для дальних: путь найден и не длиннее веса × кратчайший', () => {
    const sim = makeSim(12345);
    const astar = new AStar(sim.nav);
    const w = sim.nav.walkable;
    let checked = 0;
    for (let k = 1; k < 40 && checked < 12; k++) {
      const a = w[(k * 7919) % w.length];
      const b = w[(k * 104729) % w.length];
      if (sim.nav.level[a] !== sim.nav.level[b]) continue;
      const best = astar.find(a, b);
      const greedy = astar.find(a, b, { weight: LOD.paths.weight });
      if (!best) continue;
      expect(greedy).not.toBeNull();
      const len = (p: number[]) => {
        let s = 0;
        for (let i = 1; i < p.length; i++) s += Math.hypot(sim.nav.worldX(p[i]) - sim.nav.worldX(p[i - 1]), sim.nav.worldY(p[i]) - sim.nav.worldY(p[i - 1]));
        return s;
      };
      expect(len(greedy!)).toBeLessThanOrEqual(len(best) * LOD.paths.weight + 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
