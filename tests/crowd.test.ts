import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { AI } from '../src/config/ai';
import { CROWD, HOODS } from '../src/config/crowd';
import { AStar } from '../src/ai/AStar';
import { createCharacter } from '../src/entities/factory';
import { ZONE_NAMES } from '../src/config/names';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

/** Город с районной жизнью (как в игре) или прежней (как в остальных тестах). */
function city(hoods: boolean): Sim {
  const sim = makeSim(12345);
  sim.ctx.hoods.enabled = sim.ctx.crowd.enabled = hoods;
  spawnPopulation(sim.ctx, AI.citizens);
  return sim;
}

const residents = (sim: Sim): Character[] => sim.entities.list.filter((c) => c.alive && !c.isPlayer && (c.faction === 'citizen' || c.faction === 'cwu') && c.gang < 0);

/**
 * Люди живут своим районом, город не сбивается в одну толпу (systems/Neighborhoods.ts, systems/Crowd.ts).
 */
describe('районы и толпа', () => {
  test('районный центр — у каждого крупного квартала, на открытом месте своей зоны', () => {
    const sim = makeSim(12345);
    const { hoods, nav, map } = sim.ctx;
    // Кварталы (общежития и особняки — здания, их жители ходят к центру ближайшего квартала).
    const big = map.zones.filter((z) => z.kind === 'residential' && !z.name.startsWith(ZONE_NAMES.dorm) && z.name !== ZONE_NAMES.villas && (nav.anchorsByZone.get(z.id)?.length ?? 0) >= HOODS.minAnchors);
    expect(big.length).toBeGreaterThanOrEqual(4);
    expect(hoods.hubs.length).toBe(big.length);
    for (const h of hoods.hubs) {
      expect(map.zoneAtWorld(h.x, h.y)?.id).toBe(h.zone);
      expect(hoods.hubAt(h.x, h.y)).toBe(h);
    }
    expect(hoods.plaza).not.toBeNull();
  });

  test('карта толпы: в полной клетке путь дороже, цель прогулки туда не берут', () => {
    const sim = makeSim(12345);
    const { crowd, nav, hoods } = sim.ctx;
    crowd.enabled = true;
    const a = nav.nearestWalkable(hoods.plaza!.x, hoods.plaza!.y, 2);
    crowd.update(1);
    expect(crowd.cost(a)).toBe(0);
    expect(crowd.fullAnchor(a)).toBe(false);
    // Толпа на площади: людей больше вместимости клетки.
    for (let k = 0; k < 40; k++) createCharacter(sim.entities, sim.ctx.rng, 'citizen', hoods.plaza!.x + (k % 8) * 6 - 24, hoods.plaza!.y + Math.floor(k / 8) * 6 - 12);
    crowd.update(1);
    expect(crowd.fullAnchor(a)).toBe(true);
    expect(crowd.cost(a)).toBe(CROWD.path.max);
    expect(crowd.load(hoods.plaza!.x, hoods.plaza!.y)).toBeGreaterThan(1);
    // A* обходит людное место, если обход есть: путь сквозь площадь с ценой толпы не короче, чем без неё.
    const from = nav.nearestWalkable(hoods.plaza!.x - 900, hoods.plaza!.y, 4);
    const to = nav.nearestWalkable(hoods.plaza!.x + 900, hoods.plaza!.y, 4);
    const astar = new AStar(nav);
    const plain = astar.find(from, to);
    const around = astar.find(from, to, { crowdCost: crowd.cost });
    expect(plain && around).toBeTruthy();
    const through = (p: number[]) => p.filter((n) => crowd.cost(n) > 0).length;
    expect(through(around!)).toBeLessThanOrEqual(through(plain!));
  });

  test('расселение по всему городу: Арбат не забирает треть жителей', { timeout: 120_000 }, () => {
    const share = (sim: Sim) => {
      const rs = residents(sim).filter((c) => c.home >= 0);
      return rs.filter((c) => sim.ctx.housing.of(c)!.kind === 'arbat').length / rs.length;
    };
    const old = share(city(false));
    const now = share(city(true));
    expect(now).toBeLessThan(old * 0.7);
  });

  test('жители гуляют у своего района, площадь не собирает весь город', { timeout: 300_000 }, () => {
    // Гуляющие (прогулка и безделье): у площади ближе CROWD.near тайлов и дальше HOODS.leash от дома; толпа — жители в
    // переполненных клетках. КПЗ Управы, канцелярия, раздача и обращение — у площади по делу, это не толпа.
    const LEISURE = new Set(['walk', 'idle', 'stopped']);
    const run = (hoods: boolean) => {
      const sim = city(hoods);
      const pl = sim.ctx.hoods.plaza!;
      const R = CROWD.near * sim.map.tileSize;
      let near = 0;
      let far = 0;
      let over = 0;
      let n = 0;
      for (let t = 1; t <= 3 * 60 * 60; t++) {
        sim.step();
        if (t < 60 * 60 || t % 600) continue;
        const rs = residents(sim).filter((c) => c.home >= 0);
        const idle = rs.filter((c) => LEISURE.has(c.brain?.stateName.split(' ')[0] ?? ''));
        near += idle.filter((c) => Math.hypot(c.x - pl.x, c.y - pl.y) < R).length / idle.length;
        far += idle.filter((c) => {
          const h = sim.ctx.housing.of(c)!.at;
          return Math.hypot(h.x - c.x, h.y - c.y) > HOODS.leash * sim.map.tileSize;
        }).length / idle.length;
        const s = sim.ctx.crowd.snapshot();
        over += s.over / s.people;
        n++;
      }
      return { near: near / n, far: far / n, over: over / n };
    };
    const old = run(false);
    const now = run(true);
    expect(now.near).toBeLessThan(old.near * 0.95);
    expect(now.far).toBeLessThan(old.far * 0.75);
    expect(now.over).toBeLessThan(old.over * 0.8);
  });
});
