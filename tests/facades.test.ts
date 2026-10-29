import { describe, expect, test } from 'vitest';
import { generateCity } from '../src/world/generator/CityGenerator';
import { computeWindows, windowOn, SIDE_DX, SIDE_DY, type WindowSpot } from '../src/world/windows';
import { windowLights } from '../src/world/Lighting';
import { HEIGHT_UNIT, sunAlpha, sunOffset, sunPhase } from '../src/world/shadows';
import { MapRenderer } from '../src/world/MapRenderer';
import { LIGHTING } from '../src/config/lighting';
import { T } from '../src/world/tiles';
import type { GameMap } from '../src/world/GameMap';

const maps = new Map<number, GameMap>();
const get = (seed: number) => {
  if (!maps.has(seed)) maps.set(seed, generateCity(seed));
  return maps.get(seed)!;
};
const OUTDOOR: number[] = [T.FLOOR, T.STREET, T.PLAZA, T.COURTYARD, T.GARDEN, T.WASTE, T.SHORE];

/** Сосед окна вдоль стены: k = 1 — с большей координатой. */
const along = (o: WindowSpot, k: number) => (SIDE_DY[o.out] !== 0 ? { x: o.x + k, y: o.y } : { x: o.x, y: o.y + k });

describe('окна', () => {
  test('на стене между комнатой и улицей, не у угла; у двери — только витрина или окно тесного дома; парное — две половины рядом', () => {
    for (const seed of [12345, 7919]) {
      const map = get(seed);
      const ws = computeWindows(map);
      expect(ws.length).toBeGreaterThan(800);
      const at = new Map(ws.map((o) => [o.y * map.width + o.x, o]));
      for (const o of ws) {
        expect(map.tileAt(o.x, o.y)).toBe(T.WALL);
        expect(map.tileAt(o.x - SIDE_DX[o.out], o.y - SIDE_DY[o.out])).toBe(T.INTERIOR);
        expect(OUTDOOR).toContain(map.tileAt(o.x + SIDE_DX[o.out], o.y + SIDE_DY[o.out]));
        const sides = [-1, 1].map((k) => {
          const p = along(o, k);
          return map.tileAt(p.x, p.y);
        });
        for (const t of sides) expect([T.WALL, T.DOOR]).toContain(t);
        // У двери — витрина или единственное окно тесного дома.
        if (sides.includes(T.DOOR) && o.style !== 'shop') {
          expect(sides).toContain(T.WALL);
          expect(ws.filter((q) => q.room === o.room).length).toBe(1);
        }
        if (o.pair === 1) {
          const p = along(o, 1);
          const b = at.get(p.y * map.width + p.x);
          expect(b?.pair).toBe(2);
          expect(b?.look).toBe(o.look);
          expect(b?.out).toBe(o.out);
        }
      }
      // Без случайности мира: та же карта — те же окна.
      expect(JSON.stringify(computeWindows(map))).toBe(JSON.stringify(ws));
      // У домов почти всегда есть окно (без окон — только те, у кого на улицу выходит одна дверь; комнаты
      // общежитий смотрят в коридор).
      const homes = map.poisOf('home').filter((p) => p.kind !== 'dorm');
      const blind = homes.filter((p) => !ws.some((o) => o.x >= p.x - 1 && o.y >= p.y - 1 && o.x <= p.x + p.w! && o.y <= p.y + p.h!));
      expect(blind.length / homes.length).toBeLessThan(0.1);
    }
  });

  test('вид по полосе достатка: Слобода — ставни, доски, битые; Старый город — шторы; Верхний — парные; у лавок витрины', () => {
    const map = get(12345);
    const ws = computeWindows(map);
    const home = (d: string) => ws.filter((o) => map.districtAt(o.x, o.y) === d && o.style !== 'shop' && o.style !== 'civic');
    const slum = home('slum');
    const old = home('old');
    const upper = home('upper');
    for (const [list, style] of [[slum, 'slum'], [old, 'old'], [upper, 'upper']] as const) {
      expect(list.length).toBeGreaterThan(50);
      expect(list.every((o) => o.style === style)).toBe(true);
    }
    const share = (list: WindowSpot[], f: (o: WindowSpot) => boolean) => list.filter(f).length / list.length;
    expect(share(slum, (o) => o.look === 'boarded' || o.look === 'broken' || o.look === 'shutters' || o.look === 'closed')).toBeGreaterThan(0.3);
    expect(share(slum, (o) => o.look === 'curtains' || o.look === 'flowers')).toBe(0);
    expect(share(old, (o) => o.look === 'curtains')).toBeGreaterThan(0.3);
    expect(share(upper, (o) => o.pair > 0)).toBeGreaterThan(0.7);
    expect(share(upper, (o) => o.look === 'boarded' || o.look === 'broken')).toBe(0);
    // Лавки и кафе в ряду домов — витрины на улицу.
    const shops = map.poisOf('facade').filter((p) => p.use === 'shop' || p.use === 'cafe');
    expect(shops.length).toBeGreaterThan(3);
    for (const p of shops) {
      const inside = ws.filter((o) => o.x >= p.x && o.y >= p.y && o.x < p.x + p.w! && o.y < p.y + p.h! && o.style === 'shop');
      expect(inside.length, `витрина у лавки ${p.sub}`).toBeGreaterThan(0);
    }
  });

  test('ночью горят до отбоя, глубокой ночью темно, перед рассветом часть зажигается; свет — на улице перед окном', () => {
    const map = get(12345);
    const ws = computeWindows(map);
    const lit = ws.filter((o) => o.lit);
    expect(lit.length / ws.length).toBeGreaterThan(0.35);
    expect(ws.filter((o) => o.look === 'boarded' || o.look === 'broken' || o.look === 'closed').every((o) => !o.lit)).toBe(true);
    const on = (f: number) => lit.filter((o) => windowOn(o, f)).length / lit.length;
    expect(on(22 / 24)).toBe(1);
    expect(on(3 / 24)).toBe(0);
    const dawn = on(5.9 / 24);
    expect(dawn).toBeGreaterThan(0.1);
    expect(dawn).toBeLessThan(0.6);
    // По огню на окно (у парного — один на стыке), каждый — на улице перед окном.
    const lights = windowLights(ws, map.tileSize);
    expect(lights.length).toBe(lit.filter((o) => o.pair !== 2).length);
    for (const l of lights) expect(OUTDOOR).toContain(map.tileAt(Math.floor(l.x / map.tileSize), Math.floor(l.y / map.tileSize)));
  });
});

describe('солнце и тени', () => {
  test('утром тени на запад, в полдень на север и короче, вечером на восток; ночью теней нет', () => {
    expect(sunPhase(0.1)).toBeNull();
    expect(sunAlpha(0.1)).toBe(0);
    expect(sunAlpha(0.95)).toBe(0);
    const morning = sunOffset(0.1);
    const noon = sunOffset(0.5);
    const evening = sunOffset(0.9);
    expect(morning.dx).toBeLessThan(0);
    expect(Math.abs(morning.dx)).toBeGreaterThan(Math.abs(morning.dy));
    expect(noon.dy).toBeLessThan(0);
    expect(Math.abs(noon.dx)).toBeLessThan(1e-6);
    expect(evening.dx).toBeGreaterThan(0);
    expect(Math.hypot(noon.dx, noon.dy)).toBeLessThan(Math.hypot(morning.dx, morning.dy));
    expect(Math.hypot(morning.dx, morning.dy)).toBeLessThanOrEqual(LIGHTING.sun.storey * LIGHTING.sun.lenMax + 1e-9);
    expect(sunAlpha(0.5)).toBeCloseTo(LIGHTING.sun.alpha, 6);
    expect(sunAlpha(LIGHTING.sun.rise + 0.01)).toBeLessThan(LIGHTING.sun.alpha);
  });

  test('высота домов: Слобода ниже Старого города, стена Протектората выше всех, улица и пол без тени', () => {
    const map = get(12345);
    const H = new MapRenderer(map).heights;
    const avg = (d: string) => {
      let sum = 0;
      let n = 0;
      for (const p of map.poisOf('facade')) {
        if (map.districtAt(p.x, p.y) !== d) continue;
        for (let y = p.y; y < p.y + p.h!; y++) {
          for (let x = p.x; x < p.x + p.w!; x++) {
            if (map.tileAt(x, y) !== T.WALL) continue;
            sum += H[y * map.width + x] / HEIGHT_UNIT;
            n++;
          }
        }
      }
      return sum / n;
    };
    expect(avg('slum')).toBeLessThan(avg('old'));
    let metal = 0;
    for (let i = 0; i < map.tiles.length; i++) {
      const t = map.tiles[i];
      if (t === T.STREET || t === T.INTERIOR || t === T.FLOOR) expect(H[i]).toBe(0);
      if (t === T.METAL) {
        expect(H[i]).toBe(LIGHTING.storeys.metal * HEIGHT_UNIT);
        metal++;
      }
    }
    expect(metal).toBeGreaterThan(0);
  });
});
