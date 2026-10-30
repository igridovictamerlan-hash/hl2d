import { describe, expect, test } from 'vitest';
import { generateCity } from '../src/world/generator/CityGenerator';
import { computeBuildings } from '../src/world/buildings';
import { T } from '../src/world/tiles';

describe('здания под крышами', () => {
  for (const seed of [12345, 7919]) {
    test(`сид ${seed}: пол помещений и дома вдоль улицы — под своей крышей, у домов есть вход`, () => {
      const map = generateCity(seed);
      const { list, of } = computeBuildings(map);
      const w = map.width;
      const sewerX = map.underground ? map.underground.x : w;
      // Пол помещений в городе — всегда в каком-то здании.
      for (let i = 0; i < map.tiles.length; i++) {
        if (map.tiles[i] === T.INTERIOR && i % w < sewerX) expect(of[i], `тайл ${i % w},${Math.floor(i / w)}`).toBeGreaterThanOrEqual(0);
      }
      // Под крышей — ни улицы, ни переулка, ни площади.
      for (const b of list) for (const i of b.tiles) expect([T.STREET, T.FLOOR, T.PLAZA, T.COURTYARD]).not.toContain(map.tiles[i]);
      // Дом вдоль улицы — одно здание со своим POI.
      for (const p of map.poisOf('facade')) {
        const ids = new Set<number>();
        for (let y = p.y; y < p.y + p.h!; y++) for (let x = p.x; x < p.x + p.w!; x++) if (map.tiles[y * w + x] !== T.STREET) ids.add(of[y * w + x]);
        expect(ids.size).toBe(1);
        expect(list[[...ids][0]].facade).toBe(p);
      }
      // Жилые дома, лавки и кафе с полом — с входом на улицу.
      const homes = list.filter((b) => (b.kind === 'house' || b.kind === 'shop' || b.kind === 'cafe') && b.tiles.some((i) => map.tiles[i] === T.INTERIOR));
      expect(homes.length).toBeGreaterThan(300);
      const noDoor = homes.filter((b) => b.doors.length === 0);
      expect(noDoor.length).toBeLessThan(homes.length * 0.02);
    });
  }
});
