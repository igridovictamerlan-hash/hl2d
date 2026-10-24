import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
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

describe('живая экономика: баржи → склад ТС → полки', () => {
  test('баржа выгружает ящики у пирса, докеры везут на склад, курьеры — на полки; шлюз закрыт — баржи не приходят', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    const S = sim.ctx.supply;
    const port = sim.ctx.port!;
    expect(S.docks.length).toBe(port.barges.length);
    expect(S.store).not.toBeNull();
    const put = (prof: 'packer' | 'courier', at: { x: number; y: number }) => {
      const c = createCharacter(sim.entities, sim.ctx.rng, 'cwu', at.x, at.y);
      c.profession = prof;
      c.brain = new CitizenBrain(c, sim.ctx);
      return c;
    };
    for (let k = 0; k < 3; k++) put('packer', S.docks[k % S.docks.length].spot);
    for (let k = 0; k < 2; k++) put('courier', S.store!);
    // Полки пустеют — курьеру есть куда нести.
    for (const s of sim.ctx.shops.shops) for (const id of s.stock) s.shelf.set(id, 0);
    const barges0 = S.stats.barges;
    for (let t = 0; t < 900 * 60 && (S.stats.unloaded < 6 || sim.ctx.shops.stats.delivered < 2 || S.stats.barges === barges0); t++) sim.step();
    console.log(`экономика: ${JSON.stringify(S.stats)}, доставлено в лавки ${sim.ctx.shops.stats.delivered}`);
    expect(S.stats.barges).toBeGreaterThan(barges0);
    expect(S.stats.unloaded).toBeGreaterThanOrEqual(6);
    expect(sim.ctx.shops.stats.delivered).toBeGreaterThanOrEqual(2);
    // Шлюз закрыт: баржи в пути дойдут, ушедшие за край не возвращаются — груза больше нет.
    S.halt(1e6);
    sim.step();
    expect(S.blockade).toBe('шлюз ГЭС закрыт');
    for (let t = 0; t < 400 * 60; t++) sim.step();
    const n = S.stats.barges;
    for (let t = 0; t < 600 * 60; t++) sim.step();
    expect(S.stats.barges).toBe(n);
    expect(port.barges.some((b) => b.phase === 'away')).toBe(true);
  });
});
