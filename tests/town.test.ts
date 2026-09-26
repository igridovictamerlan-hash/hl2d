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
import { LOYALTY } from '../src/config/loyalty';
import { isLoyalistUniform } from '../src/entities/EntityRenderer';

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

describe('Нексус: общая камера, лоялисты, проспект', () => {
  test('общая камера вмещает нескольких граждан и партизана; дверь заперта, пока там сидят', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const { law, entities, ctx } = sim;
    const common = law.cells.find((c) => c.common)!;
    expect(common).toBeTruthy();
    expect(common.slots.length).toBeGreaterThanOrEqual(6);
    expect(law.cells.filter((c) => !c.common)).toHaveLength(7);
    const cp = createCharacter(entities, ctx.rng, 'cp', common.frontX, common.frontY - 40);
    const partisan = createCharacter(entities, ctx.rng, 'rebel', common.frontX, common.frontY);
    partisan.role = { kind: 'partisan', faction: 'rebel', profession: null, division: null, rank: 0, kit: 'rebel' };
    const prisoners = [0, 1, 2].map((k) => createCharacter(entities, ctx.rng, 'citizen', common.frontX + (k - 1) * 30, common.frontY + 20));
    prisoners.push(partisan);
    // Граждан и партизан — в общую камеру; солдата армии — в одиночную.
    for (const p of prisoners) expect(law.freeCell(cp.x, cp.y, p)?.common).toBe(true);
    const soldier = createCharacter(entities, ctx.rng, 'rebel', cp.x, cp.y);
    expect(law.freeCell(cp.x, cp.y, soldier)?.common).toBe(false);
    soldier.alive = false;
    for (const p of prisoners) {
      law.arrest(cp, p, 'running');
      law.putInCell(p, common);
    }
    run(sim, 30, () => prisoners.every((p) => p.law.phase === 'jailed'));
    for (const p of prisoners) expect(p.law.phase).toBe('jailed');
    expect(law.occupants(common)).toHaveLength(prisoners.length);
    // Каждый — на своём месте.
    const slots = new Set(prisoners.map((p) => law.slotOf(common, p)));
    expect(slots.size).toBe(prisoners.length);
    expect(common.door?.locked).toBe(true);
    // Одного отпускают: дверь открывается, он выходит — и дверь снова запирается за ним.
    const out = prisoners[0];
    out.law.jailUntil = law.now;
    run(sim, 1);
    expect(out.law.phase).toBe('releasing');
    expect(common.door?.locked).toBe(false);
    run(sim, 20, () => out.law.phase === 'none' && !!common.door?.locked);
    expect(law.occupants(common)).toHaveLength(prisoners.length - 1);
    expect(common.door?.locked).toBe(true);
    for (const p of prisoners.slice(1)) expect(p.law.phase).toBe('jailed');
  });

  test('лоялисты — в светло-фиолетовой форме', () => {
    const sim = makeSim(12345);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 100, 100);
    c.loyalty = 10;
    expect(isLoyalistUniform(c)).toBe(false);
    c.loyalty = LOYALTY.uniform.min;
    expect(isLoyalistUniform(c)).toBe(true);
    const w = createCharacter(sim.entities, sim.ctx.rng, 'cwu', 100, 100);
    w.loyalty = 90;
    expect(isLoyalistUniform(w)).toBe(false);
  });

  test('на главном проспекте фонари и скамейки; при зелёном коде жители садятся и беседуют', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const { map, ctx } = sim;
    const street = ctx.street;
    expect(street.lamps.length).toBeGreaterThanOrEqual(5);
    expect(street.benches.length).toBeGreaterThanOrEqual(3);
    for (const b of street.benches) {
      for (const s of b.seats) {
        expect(map.zoneAtWorld(s.x, s.y)?.kind).toBe('avenue');
        expect(sim.nav.isWalkable(Math.floor(s.x / 16) - 1, Math.floor(s.y / 16) - 1)).toBe(true);
      }
    }
    spawnPopulation(ctx, 40);
    sim.war.command.paused = true;
    let seated = 0;
    run(sim, 240, () => {
      seated = Math.max(seated, sim.entities.list.filter((c) => c.brain instanceof CitizenBrain && c.brain.fsm.current === 'bench' && c.brain.stayUntil > 0).length);
      return street.stats.benchTalks > 0 && seated >= 3;
    });
    console.log(`скамейки: ${street.benches.length}, фонари: ${street.lamps.length}, сидели максимум ${seated}, бесед ${street.stats.benchTalks}`);
    expect(seated).toBeGreaterThanOrEqual(2);
    expect(street.stats.benchTalks).toBeGreaterThan(0);
    // Красный код — со скамеек встают.
    sim.war.code = 'red';
    run(sim, 1);
    expect(sim.entities.list.some((c) => c.brain instanceof CitizenBrain && c.brain.fsm.current === 'bench')).toBe(false);
  });
});
