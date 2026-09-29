import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { generateCity } from '../src/world/generator/CityGenerator';
import { spawnPopulation, needsHome } from '../src/systems/Population';
import { respawnPoint } from '../src/systems/Roster';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { UndergroundBrain } from '../src/ai/brains/UndergroundBrain';
import { ARBAT } from '../src/config/arbat';
import { ZONE_NAMES } from '../src/config/names';
import { createCharacter } from '../src/entities/factory';

describe('штаб ГСР на проспекте', () => {
  for (const seed of [12345, 777, 3]) {
    test(`сид ${seed}: штаб фасадом на главный проспект, вдали от Нексуса и площади`, () => {
      const map = generateCity(seed);
      const hq = map.poisOf('cwu_hq')[0];
      expect(hq).toBeTruthy();
      // Вдоль всей стороны штаба, обращённой к проспекту, — асфальт главного проспекта в паре тайлов.
      let touches = 0;
      for (let x = hq.x; x < hq.x + hq.w!; x++) {
        for (const y of [hq.y - 1, hq.y - 2, hq.y + hq.h!, hq.y + hq.h! + 1]) if (map.zoneAtTile(x, y)?.name === ZONE_NAMES.avenue[0]) touches++;
      }
      expect(touches, `сид ${seed}`).toBeGreaterThanOrEqual(hq.w!);
      const cx = hq.x + hq.w! / 2;
      const cy = hq.y + hq.h! / 2;
      for (const t of ['nexus_gate', 'plaza_center'] as const) {
        const p = map.poisOf(t)[0];
        expect(Math.hypot(p.x - cx, p.y - cy), `${t}, сид ${seed}`).toBeGreaterThan(30);
      }
    });
  }
});

describe('свой дом у каждого', () => {
  test('жители, ГСР, вортигонты и подполье — с домом; Арбат заселён; возрождение — дома', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 70);
    const H = sim.ctx.housing;
    const people = sim.entities.list.filter(needsHome);
    const homeless = people.filter((c) => c.home < 0);
    console.log(`жильё: ${H.dwellings.length} комнат, жителей ${people.length}, без дома ${homeless.length}; по видам ${JSON.stringify(H.dwellings.reduce<Record<string, number>>((a, d) => ((a[d.kind] = (a[d.kind] ?? 0) + (d.households ? 1 : 0)), a), {}))}`);
    expect(homeless).toHaveLength(0);
    // Дома на Арбате (главный проспект, площадь) — заселяются первыми.
    const arbat = H.dwellings.filter((d) => d.kind === 'arbat');
    expect(arbat.length).toBeGreaterThanOrEqual(10);
    expect(arbat.filter((d) => d.households > 0).length / arbat.length).toBeGreaterThan(0.8);
    // Каждому своё (семья — одна комната на всех).
    const byHome = new Map<number, Set<string>>();
    for (const c of people) {
      const set = byHome.get(c.home) ?? new Set<string>();
      set.add(c.family >= 0 ? `семья ${c.family}` : `житель ${c.id}`);
      byHome.set(c.home, set);
    }
    expect([...byHome.values()].every((s) => s.size === 1)).toBe(true);
    // Подполье — в явках с тайником, подальше от Нексуса.
    const under = people.filter((c) => c.faction === 'rebel');
    expect(under.length).toBeGreaterThanOrEqual(3);
    for (const c of under) expect(H.stashOf(c)).not.toBeNull();
    // Возрождение жителя — у себя дома.
    const cit = people.find((c) => c.faction === 'citizen' && c.role)!;
    const p = respawnPoint(sim.ctx, { ...cit.role! })!;
    expect(H.inside(H.of(cit)!, p)).toBe(true);
  });

  test('жители заходят домой и выходят из своих дверей на проспект', { timeout: 300_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    spawnPopulation(sim.ctx, 50);
    const H = sim.ctx.housing;
    let insideOwn = 0;
    for (let t = 0; t < 300 * 60; t++) {
      sim.step();
      if (t % 600 === 0) insideOwn = Math.max(insideOwn, sim.entities.list.filter((c) => c.home >= 0 && H.inside(H.of(c)!, c)).length);
    }
    console.log(`дома: ${JSON.stringify(H.stats)}, одновременно у себя дома до ${insideOwn}`);
    expect(H.stats.visits).toBeGreaterThan(15);
    expect(insideOwn).toBeGreaterThanOrEqual(5);
  });
});

describe('лавки проспекта: продавцы и товар из штаба ГСР', () => {
  test('за прилавками продавцы, курьеры носят коробки из штаба, товар расходится', { timeout: 400_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    spawnPopulation(sim.ctx, 50);
    const S = sim.ctx.shops;
    const staffed = S.staffed;
    expect(staffed.length).toBeGreaterThanOrEqual(4);
    expect(staffed.every((s) => s.vendor?.profession === 'vendor')).toBe(true);
    expect(S.cook?.profession).toBe('canteen_cook');
    for (const c of sim.entities.list) {
      if (c.faction !== 'citizen') continue;
      c.money = Math.max(c.money, 40);
      c.hunger = 60;
    }
    let openShare = 0;
    let samples = 0;
    for (let t = 0; t < 360 * 60; t++) {
      sim.step();
      if (t % 300 === 0 && t > 30 * 60) {
        openShare += staffed.filter((s) => S.open(s)).length / staffed.length;
        samples++;
      }
    }
    openShare /= samples;
    console.log(`лавки: ${JSON.stringify(S.stats)}, открыто в среднем ${Math.round(openShare * 100)}%, запасы ${S.shops.map((s) => `${s.sub}:${s.goods}`).join(' ')}, суп ${S.soup}`);
    expect(openShare).toBeGreaterThan(0.5);
    expect(S.stats.purchases).toBeGreaterThan(3);
    expect(S.stats.delivered).toBeGreaterThan(0);
  });

  test('без продавца — закрыто, без товара — пусто; покупка снимает единицу запаса', () => {
    const sim = makeSim(12345);
    const S = sim.ctx.shops;
    const s = S.staffed.find((q) => q.stock.length)!;
    expect(S.refusal(s)).toBe('closed');
    // Продавец на месте.
    const v = createCharacter(sim.entities, sim.ctx.rng, 'cwu', s.vendorSpot!.x, s.vendorSpot!.y);
    v.profession = 'vendor';
    s.vendor = v;
    expect(S.refusal(s)).toBe(null);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', s.front.x, s.front.y);
    c.money = 100;
    const before = s.goods;
    expect(S.buy(c, s, s.stock[0])).toBe(null);
    expect(s.goods).toBe(before - 1);
    s.goods = 0;
    expect(S.refusal(s)).toBe('empty');
    expect(S.buy(c, s, s.stock[0])).toContain('кончился');
    // Коробка из штаба пополняет полки.
    const courier = createCharacter(sim.entities, sim.ctx.rng, 'cwu', s.front.x, s.front.y);
    courier.profession = 'courier';
    courier.carrying = true;
    expect(S.deliver(courier, { shop: s })).toBe(true);
    expect(s.goods).toBe(ARBAT.supply.perBox);
  });
});

describe('явки подполья', () => {
  test('добыча со склада — в тайник своей явки, оттуда ствол бандиту', { timeout: 200_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 30);
    sim.insurgency.paused = true;
    const H = sim.ctx.housing;
    const p = sim.insurgency.garrison.find((c) => c.brain instanceof UndergroundBrain)!;
    const home = H.of(p)!;
    expect(home.stash).not.toBeNull();
    // Партизан с ящиком со склада — в городе, у склада.
    const A = sim.arsenal;
    p.x = p.prevX = A.window!.x;
    p.y = p.prevY = A.window!.y;
    const ownGuns = p.inventory.count('mp7');
    sim.insurgency.haul(p, 'grenades', 2);
    sim.insurgency.haul(p, 'weapons', 1);
    expect(sim.insurgency.carryingLoot(p)).toBe(true);
    const brain = p.brain as UndergroundBrain;
    brain.mode = 'depot';
    (brain as unknown as { goHome(c: typeof p, ctx: typeof sim.ctx): void }).goHome(p, sim.ctx);
    expect(brain.mode).toBe('stash');
    let t = 0;
    for (; t < 180 * 60 && !home.stash!.has('mp7'); t++) sim.step();
    console.log(`явка: ${(t / 60).toFixed(0)} с, в тайнике ${JSON.stringify(home.stash!.slots)}, режим ${brain.mode}`);
    expect(home.stash!.count('grenade')).toBe(2);
    expect(home.stash!.count('mp7')).toBe(1);
    expect(p.inventory.count('mp7')).toBe(ownGuns);
    // Ствол бандиту — из тайника.
    const bandit = sim.entities.list.find((c) => c.profession === 'bandit' && c.brain instanceof CitizenBrain)!;
    expect(sim.insurgency.armBandit(p, bandit)).toBe(true);
    expect(home.stash!.count('mp7')).toBe(0);
    expect(sim.insurgency.stats.fromStash).toBe(1);
  });
});
