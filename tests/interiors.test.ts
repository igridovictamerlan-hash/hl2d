import { describe, expect, test } from 'vitest';
import { CELL, passBy, planHome, planReachable, planShop, sideStep, type Plan, type Side } from '../src/world/generator/interiors';
import { generateCity } from '../src/world/generator/CityGenerator';
import { T } from '../src/world/tiles';
import type { GameMap } from '../src/world/GameMap';

/** Двери плана — группы соседних клеток по 2 (иначе две двери склеились бы в одну). */
function doorGroups(p: Plan): number[] {
  const seen = new Uint8Array(p.W * p.D);
  const sizes: number[] = [];
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] !== CELL.DOOR || seen[i]) continue;
    let n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const c = j % p.W;
      const r = (j - c) / p.W;
      for (let k = 0; k < 4; k++) {
        const [dc, dr] = sideStep(k as Side);
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= p.W || nr >= p.D) continue;
        const q = nr * p.W + nc;
        if (p.cells[q] === CELL.DOOR && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    sizes.push(n);
  }
  return sizes;
}

describe('планировка помещений', () => {
  test('квартиры: любой план проходим пешкой, комнаты не уже 2 клеток, двери по 2 клетки', () => {
    let multi = 0;
    for (const d of ['slum', 'old', 'upper', null] as const) {
      for (let W = 2; W <= 10; W++) {
        for (let D = 2; D <= 9; D++) {
          for (let door = 0; door <= W - 2; door++) {
            const p = planHome(W, D, door, d, W * 97 + D * 13 + door);
            expect(planReachable(p.cells, W, D, door), `${d} ${W}×${D} дверь ${door}`).toBe(true);
            expect(p.cells[door]).toBe(CELL.FLOOR);
            expect(p.cells[door + 1]).toBe(CELL.FLOOR);
            for (const rm of p.rooms) {
              expect(rm.c1 - rm.c0 + 1).toBeGreaterThanOrEqual(2);
              expect(rm.r1 - rm.r0 + 1).toBeGreaterThanOrEqual(2);
              for (let r = rm.r0; r <= rm.r1; r++) for (let c = rm.c0; c <= rm.c1; c++) expect(p.cells[r * W + c]).toBe(CELL.FLOOR);
            }
            for (const n of doorGroups(p)) expect(n).toBe(2);
            if (p.rooms.length > 1) multi++;
            // Отдельное жильё (комнаты коммуналки) — только в Слободе.
            if (d !== 'slum') expect(p.rooms.length === 1 || p.rooms.every((rm) => !rm.dwelling)).toBe(true);
          }
        }
      }
    }
    expect(multi).toBeGreaterThan(300);
  });

  test('по полосе достатка: Слобода — коммуналка, Старый и Верхний город — прихожая, кухня, комнаты', () => {
    const slum = planHome(10, 6, 4, 'slum', 1);
    expect(slum.rooms.filter((r) => r.dwelling).length).toBeGreaterThanOrEqual(2);
    expect(slum.rooms.some((r) => r.kind === 'corridor' || r.kind === 'kitchen')).toBe(true);
    const old = planHome(9, 8, 3, 'old', 2);
    expect(old.rooms.map((r) => r.kind)).toEqual(expect.arrayContaining(['hall', 'kitchen', 'bedroom']));
    const upper = planHome(9, 8, 3, 'upper', 3);
    expect(upper.rooms.map((r) => r.kind)).toEqual(expect.arrayContaining(['hall', 'kitchen', 'bath', 'living', 'bedroom']));
    // Тесная — одна комната.
    expect(planHome(3, 3, 0, 'upper', 4).rooms).toHaveLength(1);
  });

  test('лавки: прилавок между покупателем и продавцом, оба доступны и не запирают друг друга, оборудование не перекрывает проход', () => {
    let plans = 0;
    let tight = 0;
    for (const sub of ['cwu', 'tobacco', 'pharmacy', 'bakery', 'hardware', 'tailor', 'tailor_up', 'cafe', 'coffee']) {
      for (let W = 4; W <= 12; W++) {
        for (let D = 5; D <= 8; D++) {
          for (let door = 0; door <= W - 2; door++) {
            for (const left of [false, true]) {
              const p = planShop(W, D, door, sub, left, W * 31 + D * 7 + door);
              if (!p) continue;
              plans++;
              const where = `${sub} ${W}×${D} дверь ${door}`;
              expect(p.front && p.vendor, where).toBeTruthy();
              expect(planReachable(p.cells, W, D, door, [p.front!, p.vendor!]), where).toBe(true);
              // Клетки оборудования — ровно прямоугольники оборудования.
              let fix = 0;
              for (const f of p.fixtures) fix += (f.c1 - f.c0 + 1) * (f.r1 - f.r0 + 1);
              expect(p.cells.filter((v) => v === CELL.FIX).length, where).toBe(fix);
              // Прилавок (первое оборудование) — вплотную и к покупателю, и к продавцу.
              const desk = p.fixtures[0];
              const touches = (s: { c: number; r: number }) => {
                for (const [c, r] of [[s.c, s.r], [s.c + 1, s.r], [s.c, s.r + 1], [s.c + 1, s.r + 1]]) {
                  for (let k = 0; k < 4; k++) {
                    const [dc, dr] = sideStep(k as Side);
                    if (c + dc >= desk.c0 && c + dc <= desk.c1 && r + dr >= desk.r0 && r + dr <= desk.r1) return true;
                  }
                }
                return false;
              };
              expect(['counter', 'case', 'bar']).toContain(desk.kind);
              expect(touches(p.front!), where).toBe(true);
              expect(touches(p.vendor!), where).toBe(true);
              // Покупатель у прилавка не запирает лавку продавцу (и следующему покупателю), продавец — покупателю; иначе
              // только в тесной лавке в 4 клетки, где по-другому не встать.
              if (p.tight) {
                tight++;
                expect(W, where).toBe(4);
              } else {
                expect(passBy(p.cells, W, D, door, p.front!, p.vendor!), where).toBe(true);
                expect(passBy(p.cells, W, D, door, p.vendor!, p.front!), where).toBe(true);
              }
            }
          }
        }
      }
    }
    expect(plans).toBeGreaterThan(2500);
    expect(tight).toBeLessThan(plans * 0.02);
  });
});

describe('планировка в городе', () => {
  const maps = new Map<number, GameMap>();
  const get = (seed: number) => {
    if (!maps.has(seed)) maps.set(seed, generateCity(seed));
    return maps.get(seed)!;
  };

  for (const seed of [12345, 7919]) {
    test(`сид ${seed}: у лавок и кафе — прилавок, стеллажи и столики; у квартир — комнаты по назначению`, () => {
      const map = get(seed);
      const fixtures = map.poisOf('shop_fixture');
      const shops = map.poisOf('facade').filter((q) => q.use === 'shop' || q.use === 'cafe');
      // Кроме прилавка — стеллажи, витрины, столики: в среднем больше одного на лавку.
      expect(fixtures.length).toBeGreaterThan(shops.length * 2);
      for (const f of shops) {
        const own = fixtures.filter((x) => x.id === f.id);
        expect(own.some((x) => x.sub === 'counter' || x.sub === 'case' || x.sub === 'bar'), `лавка ${f.sub}`).toBe(true);
        // Оборудование — укрытие внутри дома.
        for (const x of own) {
          for (let y = x.y; y < x.y + x.h!; y++) for (let xx = x.x; xx < x.x + x.w!; xx++) expect(map.tileAt(xx, y)).toBe(T.BARRIER);
          expect(x.x >= f.x && x.y >= f.y && x.x + x.w! <= f.x + f.w! && x.y + x.h! <= f.y + f.h!).toBe(true);
        }
      }
      expect(map.poisOf('cafe_table').length).toBeGreaterThanOrEqual(2);
      // Комнаты: пол внутри, назначение — из набора; квартиры с прихожей и кухней есть, коммуналки — в Слободе.
      const rooms = map.poisOf('room');
      for (const r of rooms) {
        for (let y = r.y; y < r.y + r.h!; y++) for (let x = r.x; x < r.x + r.w!; x++) expect([T.INTERIOR, T.BARRIER]).toContain(map.tileAt(x, y));
      }
      const kinds = new Set(rooms.map((r) => r.sub));
      for (const k of ['hall', 'kitchen', 'bedroom', 'living', 'sales']) expect(kinds.has(k), k).toBe(true);
      const communal = map.poisOf('home').filter((h) => rooms.some((r) => r.sub === 'room' && r.x === h.x && r.y === h.y && r.w === h.w && r.h === h.h));
      expect(communal.length).toBeGreaterThan(5);
      for (const h of communal) expect(map.districtAt(h.x, h.y)).toBe('slum');
    });
  }
});
