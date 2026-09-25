import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import type { Character } from '../src/entities/Character';

describe('живой мир', () => {
  test('пробки в переулках рассасываются: никто не стоит, упёршись, дольше 20 с', { timeout: 120_000 }, () => {
    // Сид 12345: у магазина раньше собиралась «вечная» пробка (гражданин стоял 358 с).
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const stuck = new Map<Character, number>();
    let worst = 0;
    for (let t = 0; t < 450 * 60; t++) {
      sim.step();
      if (t % 30) continue;
      for (const c of sim.entities.list) {
        if (!c.alive) continue;
        const s = Math.hypot(c.wantX, c.wantY) > 20 && c.moveSpeed < 5 ? (stuck.get(c) ?? 0) + 0.5 : 0;
        stuck.set(c, s);
        worst = Math.max(worst, s);
      }
    }
    console.log(`дольше всех упирался: ${worst} с`);
    expect(worst).toBeLessThan(20);
  });
});
