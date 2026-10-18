import { describe, expect, test } from 'vitest';
import { generateCity } from '../src/world/generator/CityGenerator';
import { PortSystem } from '../src/systems/Port';
import { T } from '../src/world/tiles';

describe('речной порт: баржи', () => {
  test('баржа отходит от причала по воде, уходит за край и возвращается', () => {
    const map = generateCity(12345);
    const port = new PortSystem(map, map.seed);
    expect(port.barges.length).toBeGreaterThanOrEqual(3);
    const ts = map.tileSize;
    const res = map.poisOf('reservoir')[0];
    const phases = new Set<string>();
    let dry = 0;
    for (let t = 0; t < 20 * 60 * 4; t++) {
      port.update(1 / 4);
      for (const b of port.barges) {
        phases.add(b.phase);
        // На ходу внутри водохранилища под баржей — вода.
        const tx = Math.floor(b.x / ts);
        if (b.moving && tx < res.x + res.w! - 2 && map.tileAt(tx, Math.floor(b.y / ts)) !== T.WATER) dry++;
      }
    }
    expect([...phases].sort()).toEqual(['away', 'in', 'moored', 'out']);
    expect(port.arrivals).toBeGreaterThan(0);
    expect(dry).toBe(0);
  });
});
