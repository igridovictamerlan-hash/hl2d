import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { T } from '../src/world/tiles';
import { computeLots } from '../src/world/houses';
import { spawnPopulation, poiWorld } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { OtaBrain } from '../src/ai/brains/OtaBrain';
import { LABOR } from '../src/config/labor';

type Sim = ReturnType<typeof makeSim>;
const run = (sim: Sim, secs: number, until?: () => boolean) => {
  for (let t = 0; t < secs * 60; t++) {
    sim.step();
    if (until?.()) return;
  }
};

describe('городок с домиками', () => {
  test('застройка нарезана на дома; жилые дома — комната со стенами и дверью на переулок', () => {
    const sim = makeSim(12345);
    const { map, nav } = sim;
    const { lots } = computeLots(map.width, map.height, map.tiles, map.seed);
    expect(lots.length).toBeGreaterThan(300);
    const homes = map.poisOf('home');
    expect(homes.length).toBeGreaterThan(30);
    for (const h of homes) {
      // Пол комнаты, вокруг — стены, в стене — дверь, из комнаты можно выйти (якорь в комнате доступен).
      for (let y = h.y; y < h.y + h.h!; y++) for (let x = h.x; x < h.x + h.w!; x++) expect(map.tileAt(x, y)).toBe(T.INTERIOR);
      let doors = 0;
      for (let x = h.x - 1; x <= h.x + h.w!; x++) for (const y of [h.y - 1, h.y + h.h!]) if (map.tileAt(x, y) === T.DOOR) doors++;
      for (let y = h.y; y < h.y + h.h!; y++) for (const x of [h.x - 1, h.x + h.w!]) if (map.tileAt(x, y) === T.DOOR) doors++;
      expect(doors).toBe(2);
      expect(nav.nearestWalkable((h.x + 1) * map.tileSize, (h.y + 1) * map.tileSize, 1)).toBeGreaterThanOrEqual(0);
    }
  });

  test('Нексус: 7 камер, казарма ГО, комната OTA, канцелярия, кабинет с терминалом', () => {
    const sim = makeSim(12345);
    const { map } = sim;
    expect(map.poisOf('cell').length).toBeGreaterThanOrEqual(7);
    expect(map.poisOf('bunk').length).toBe(10);
    expect(map.poisOf('ota_spot').length).toBe(6);
    expect(map.poisOf('clerk_desk').length).toBe(6);
    expect(map.poisOf('code_terminal')).toHaveLength(1);
    for (const t of ['bunk', 'ota_spot', 'clerk_desk'] as const) {
      for (const p of map.poisOf(t)) expect(map.zoneAtTile(p.x, p.y)?.kind).toBe('nexus');
    }
    expect(sim.ctx.labor.desks.length).toBe(6);
  });

  test('OTA ждёт в своей комнате; ГО возрождается в казарме', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    const o = spawnRole(sim.ctx, { kind: 'ota', faction: 'ota', profession: 'ota_soldier', division: null, rank: 0, kit: 'ota' })!;
    run(sim, 40);
    const spots = sim.map.poisOf('ota_spot');
    const ts = sim.map.tileSize;
    expect((o.brain as OtaBrain).mode).toBe('reserve');
    expect(Math.min(...spots.map((s) => Math.hypot(o.x - (s.x + 0.5) * ts, o.y - (s.y + 0.5) * ts)))).toBeLessThan(40);
  });

  test('лоялист ходит в канцелярию Нексуса, работает с бумагами и получает плату', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    const a = sim.nav.nearestWalkable(plaza.x, plaza.y, 6);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', sim.nav.worldX(a), sim.nav.worldY(a));
    c.profession = 'citizen';
    c.loyalty = 80;
    c.brain = new CitizenBrain(c, sim.ctx);
    const b = c.brain as CitizenBrain;
    run(sim, 240, () => b.job?.kind === 'paper');
    expect(b.job?.kind).toBe('paper');
    // Дошёл до стола в Нексусе и получил плату за отчёт.
    const money = c.money;
    const loyalty = c.loyalty;
    run(sim, 120, () => c.money >= money + LABOR.paperwork.pay);
    expect(c.money).toBeGreaterThanOrEqual(money + LABOR.paperwork.pay);
    expect(c.loyalty).toBeGreaterThan(loyalty);
    expect(sim.map.zoneAtWorld(c.x, c.y)?.kind).toBe('nexus');
  });
});
