import { describe, expect, test } from 'vitest';
import { generateCity } from '../src/world/generator/CityGenerator';
import { T, SOLID } from '../src/world/tiles';
import { ARBAT } from '../src/config/arbat';
import type { GameMap } from '../src/world/GameMap';

const maps = new Map<number, GameMap>();
const get = (seed: number) => {
  if (!maps.has(seed)) maps.set(seed, generateCity(seed));
  return maps.get(seed)!;
};

describe('проспект старого города', () => {
  for (const seed of [12345, 7919, 424242]) {
    test(`сид ${seed}: вдоль проспекта сплошной ряд домов, у каждого дверь на улицу`, () => {
      const map = get(seed);
      const facades = map.poisOf('facade');
      expect(facades.length).toBeGreaterThan(40);
      for (const f of facades) {
        // Дверь дома — в его прямоугольнике, перед ней (со стороны фасада) — улица или площадь.
        const [dx, dy] = f.face === 'N' ? [0, -1] : f.face === 'S' ? [0, 1] : f.face === 'W' ? [-1, 0] : [1, 0];
        let doorOnStreet = false;
        for (let y = f.y; y < f.y + f.h!; y++) {
          for (let x = f.x; x < f.x + f.w!; x++) {
            if (map.tileAt(x, y) !== T.DOOR) continue;
            let k = 1;
            while (map.tileAt(x + dx * k, y + dy * k) === T.DOOR) k++;
            const t = map.tileAt(x + dx * k, y + dy * k);
            if (t === T.STREET || t === T.PLAZA) doorOnStreet = true;
          }
        }
        expect(doorOnStreet, `дом ${f.id} (${f.use}) в ${f.x},${f.y}`).toBe(true);
      }
      // Главный проспект: большая часть его краёв — стены домов, а не глухая застройка.
      const av = map.zones.find((z) => z.name === 'Главный проспект')!;
      const inFacade = new Uint8Array(map.width * map.height);
      for (const f of facades) for (let y = f.y; y < f.y + f.h!; y++) for (let x = f.x; x < f.x + f.w!; x++) inFacade[y * map.width + x] = 1;
      let edge = 0;
      let house = 0;
      for (let y = 1; y < map.height - 1; y++) {
        for (let x = 1; x < map.width - 1; x++) {
          if (map.zoneGrid[y * map.width + x] !== av.id || map.tileAt(x, y) !== T.STREET) continue;
          for (const ny of [y - 1, y + 1]) {
            const t = map.tileAt(x, ny);
            if (SOLID[t] !== 1 || t === T.BARRIER || t === T.METAL) continue;
            edge++;
            if (inFacade[ny * map.width + x]) house++;
          }
        }
      }
      expect(house / edge).toBeGreaterThan(0.7);
    });

    test(`сид ${seed}: столовая со столами, лавки, магазин ГСР, ларьки и клумбы`, () => {
      const map = get(seed);
      const canteen = map.poisOf('canteen');
      expect(canteen).toHaveLength(1);
      expect(map.poisOf('canteen_table').length).toBeGreaterThanOrEqual(2);
      expect(map.poisOf('canteen_cook')).toHaveLength(1);
      expect(map.zones.some((z) => z.kind === 'canteen' && z.name === ARBAT.canteen.name)).toBe(true);
      const shops = map.poisOf('facade').filter((f) => f.use === 'shop');
      expect(shops.length).toBeGreaterThanOrEqual(4);
      expect(shops.some((s) => s.sub === 'cwu')).toBe(true);
      expect(map.poisOf('shop_counter')).toHaveLength(1);
      expect(map.poisOf('vendor_spot').length).toBeGreaterThanOrEqual(shops.length);
      expect(map.poisOf('kiosk').length).toBeGreaterThanOrEqual(2);
      // Ларёк — укрытие посередине проспекта, вокруг — свободный асфальт.
      for (const k of map.poisOf('kiosk')) {
        for (let y = k.y; y < k.y + k.h!; y++) for (let x = k.x; x < k.x + k.w!; x++) expect(map.tileAt(x, y)).toBe(T.BARRIER);
        expect(map.tileAt(k.x - 1, k.y)).toBe(T.STREET);
        expect(map.tileAt(k.x + k.w!, k.y + k.h! - 1)).toBe(T.STREET);
      }
    });
  }

  test('проспект изгибается: верхний край асфальта не прямая линия', () => {
    const map = get(12345);
    const av = map.zones.find((z) => z.name === 'Главный проспект')!;
    const tops = new Set<number>();
    for (let x = 80; x < map.width - 80; x++) {
      for (let y = 0; y < map.height; y++) {
        if (map.zoneGrid[y * map.width + x] === av.id) {
          tops.add(y);
          break;
        }
      }
    }
    expect(tops.size).toBeGreaterThanOrEqual(5);
  });
});

describe('жизнь проспекта', () => {
  test('горожане едят за столами общей столовой и ходят по лавкам', { timeout: 400_000 }, async () => {
    const { makeSim } = await import('./simHarness');
    const { spawnPopulation } = await import('../src/systems/Population');
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    spawnPopulation(sim.ctx, 40);
    const shops = sim.ctx.shops;
    expect(shops.seats.length).toBeGreaterThanOrEqual(6);
    expect(shops.shops.filter((s) => s.kind === 'kiosk').length).toBeGreaterThanOrEqual(2);
    // Паёк на руках и лёгкий голод — после раздачи.
    for (const c of sim.entities.list) {
      if (c.faction !== 'citizen') continue;
      c.inventory.add('ration', 1);
      c.hunger = 55;
      c.money = Math.max(c.money, 20);
    }
    let seated = 0;
    for (let t = 0; t < 180 * 60; t++) {
      sim.step();
      if (t % 60 === 0) seated = Math.max(seated, shops.seats.filter((s) => s.taken && Math.hypot(s.taken.x - s.x, s.taken.y - s.y) < 12).length);
    }
    console.log(`за 180 с: ${JSON.stringify(shops.stats)}, одновременно за столами ${seated}`);
    expect(shops.stats.meals).toBeGreaterThan(3);
    expect(seated).toBeGreaterThanOrEqual(2);
    // Сытые и при деньгах — по лавкам.
    for (const c of sim.entities.list) {
      if (c.faction !== 'citizen') continue;
      c.hunger = 100;
      c.money = Math.max(c.money, 30);
    }
    const before = { ...shops.stats };
    for (let t = 0; t < 180 * 60; t++) sim.step();
    console.log(`ещё 180 с: ${JSON.stringify(shops.stats)}`);
    expect(shops.stats.visits - before.visits).toBeGreaterThan(2);
    expect(shops.stats.purchases - before.purchases).toBeGreaterThan(0);
  });
});
