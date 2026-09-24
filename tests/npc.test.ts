import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { Mover } from '../src/ai/Mover';
import type { Brain } from '../src/ai/Brain';
import type { Character } from '../src/entities/Character';
import type { AiContext } from '../src/ai/AiContext';
import { circleHitsSolid } from '../src/world/collision';

/** Мозг для теста: идёт к заданной цели и останавливается. */
class GoalBrain implements Brain {
  readonly mover = new Mover(75);
  stateName = 'goal';
  constructor(self: Character, ctx: AiContext, goal: number) {
    this.mover.goTo(self, ctx, goal);
  }
  update(self: Character, ctx: AiContext, dt: number) {
    this.mover.update(self, ctx, dt);
  }
}

describe('NPC в тесном городе', () => {
  test('20 граждан 2 минуты: не застревают, не проходят сквозь стены', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const { nav, entities, ctx, map } = sim;
    for (let k = 0; k < 20; k++) {
      const a = ctx.rng.pick(nav.walkable);
      const c = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(a), nav.worldY(a));
      c.brain = new CitizenBrain(c, ctx);
    }
    // Сколько секунд подряд NPC «хочет идти», но почти не двигается.
    const stuckFor = new Map<number, number>();
    let maxStuck = 0;
    let arrivals = 0;
    let wallHits = 0;
    const prevState = new Map<number, string>();
    for (let t = 0; t < 120 * 60; t++) {
      sim.step();
      for (const c of entities.list) {
        const m = c.brain!.mover;
        const wants = Math.hypot(c.wantX, c.wantY) > 20;
        const s = wants && c.moveSpeed < 5 ? (stuckFor.get(c.id) ?? 0) + 1 / 60 : 0;
        stuckFor.set(c.id, s);
        maxStuck = Math.max(maxStuck, s);
        if (prevState.get(c.id) !== 'arrived' && m.status === 'arrived') arrivals++;
        prevState.set(c.id, m.status);
        // Допуск 1 px на численную погрешность выталкивания.
        if (circleHitsSolid(map, c.x, c.y, c.radius - 1)) wallHits++;
      }
    }
    console.log(`прибытий: ${arrivals}, макс. застревание: ${maxStuck.toFixed(1)} с, касаний стен: ${wallHits}`);
    expect(wallHits).toBe(0);
    expect(arrivals).toBeGreaterThan(40);
    expect(maxStuck).toBeLessThan(8);
  });

  test('лобовая встреча в узком проходе: оба доходят до цели', { timeout: 30_000 }, () => {
    const sim = makeSim(12345);
    const { nav, entities, ctx } = sim;
    // Ищем прямой узкий коридор: 10+ подряд «узких» якорей по горизонтали или вертикали.
    let found: { a: number; b: number } | null = null;
    for (const i of nav.walkable) {
      if (nav.cost[i] <= 1) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        let n = 0;
        let x = nav.ax(i);
        let y = nav.ay(i);
        while (nav.isWalkable(x + dx, y + dy) && nav.cost[(y + dy) * nav.w + x + dx] > 1 && n < 14) {
          x += dx;
          y += dy;
          n++;
        }
        if (n >= 10) {
          found = { a: i, b: y * nav.w + x };
          break;
        }
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { a, b } = found!;
    const p = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(a), nav.worldY(a));
    const q = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(b), nav.worldY(b));
    p.brain = new GoalBrain(p, ctx, b);
    q.brain = new GoalBrain(q, ctx, a);
    // Время первого прибытия каждого (после прибытия их могут снова подвинуть — это нормально).
    const arrivedAt = new Map<number, number>();
    for (let t = 0; t < 30 * 60 && arrivedAt.size < 2; t++) {
      sim.step();
      for (const c of [p, q]) if (!arrivedAt.has(c.id) && c.brain!.mover.status === 'arrived') arrivedAt.set(c.id, t / 60);
    }
    console.log(`прибыли: ${[...arrivedAt.values()].map((t) => t.toFixed(1) + ' с').join(', ')}`);
    expect(arrivedAt.size).toBe(2);
    expect(Math.max(...arrivedAt.values())).toBeLessThan(15);
  });
});
