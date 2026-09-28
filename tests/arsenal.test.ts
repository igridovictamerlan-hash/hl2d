import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { generateCity, validateMap } from '../src/world/generator/CityGenerator';
import { spawnRole, type RoleSpec } from '../src/systems/Roster';
import { spawnPopulation } from '../src/systems/Population';
import { createCharacter } from '../src/entities/factory';
import { ARSENAL } from '../src/config/arsenal';
import { CP_UNIT, cpUnit, type CpUnitId } from '../src/config/factions';
import { SOLID, T } from '../src/world/tiles';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * 60; i++) sim.step();
}

/** Пока не выполнится условие (не дольше max с). */
function until(sim: Sim, max: number, done: () => boolean): boolean {
  for (let s = 0; s < max; s++) {
    if (done()) return true;
    run(sim, 1);
  }
  return done();
}

const cp = (kind: RoleSpec['kind'], unit: CpUnitId, extra: Partial<RoleSpec> = {}): RoleSpec => {
  const rank = CP_UNIT[unit];
  return { kind, faction: 'cp', profession: null, division: cpUnit(rank).group, rank, kit: cpUnit(rank).kit, ...extra };
};

/** Кладовщик за столом (лицом к окну). */
function quartermaster(sim: Sim): Character {
  const A = sim.arsenal;
  const seat = A.deskSpot ?? A.desk!;
  const face = Math.atan2(A.window!.y - A.desk!.y, A.window!.x - A.desk!.x);
  return spawnRole(sim.ctx, cp('qm', 'qm', { post: seat, facing: face }), seat)!;
}

function worker(sim: Sim, profession: 'loader' | 'armorer', at = sim.arsenal.waitSpot!): Character {
  return spawnRole(sim.ctx, { kind: 'cwu', faction: 'cwu', profession, division: null, rank: 0, kit: 'cwu' }, at)!;
}

const onPad = (sim: Sim) => sim.arsenal.crates.filter((c) => sim.arsenal.onPad(c.x, c.y)).length;

describe('склад Альянса 2.0', () => {
  test('генератор: здание с Нексус, квадратное крыльцо, вход один — с крыльца на улицу', () => {
    for (const seed of [12345, 7919, 2024]) {
      const map = generateCity(seed);
      expect(validateMap(map), `сид ${seed}`).toEqual([]);
      const a = map.poisOf('arsenal')[0];
      expect(a, `сид ${seed}`).toBeTruthy();
      expect(a.w! * a.h!).toBe(36 * 46);
      const pad = map.poisOf('arsenal_pad')[0];
      expect(Math.abs(pad.w! - pad.h!)).toBeLessThanOrEqual(2);
      expect(pad.w! * pad.h!).toBeGreaterThanOrEqual(16 * 16);
      expect(map.poisOf('arsenal_drop')).toHaveLength(8);
      expect(map.poisOf('arsenal_post')).toHaveLength(4);
      expect(map.poisOf('arsenal_window')).toHaveLength(2);
      expect(map.poisOf('arsenal_ammo').length).toBeGreaterThanOrEqual(40);
      // По периметру здания проходимы только тайлы проёма крыльца — и все выходят на асфальт.
      const open: [number, number][] = [];
      for (let y = a.y; y < a.y + a.h!; y++) {
        for (let x = a.x; x < a.x + a.w!; x++) {
          const edge = x === a.x || y === a.y || x === a.x + a.w! - 1 || y === a.y + a.h! - 1;
          if (edge && !SOLID[map.tileAt(x, y)]) open.push([x, y]);
        }
      }
      expect(open.length, `сид ${seed}`).toBeGreaterThanOrEqual(4);
      for (const [x, y] of open) {
        expect(map.tileAt(x, y)).not.toBe(T.DOOR);
        expect(x >= pad.x && x < pad.x + pad.w! && y >= pad.y && y < pad.y + pad.h!, `сид ${seed}: проём ${x},${y} вне крыльца`).toBe(true);
        const d = x === a.x ? [-1, 0] : x === a.x + a.w! - 1 ? [1, 0] : y === a.y ? [0, -1] : [0, 1];
        expect(map.tileAt(x + d[0], y + d[1]), `сид ${seed}: за проёмом ${x},${y}`).toBe(T.STREET);
      }
      // Проём одним куском.
      const xs = open.map(([x]) => x);
      const ys = open.map(([, y]) => y);
      expect(Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) + 1).toBe(open.length);
    }
  });

  test('борт по заявке: контейнер на крыльцо, кладовщик на приёмке, грузчики раскладывают по ячейкам', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    expect(A.present).toBe(true);
    const qm = quartermaster(sim);
    const ls = [worker(sim, 'loader'), worker(sim, 'loader')];
    // Зал почти пуст — кладовщик заказывает борт раньше расписания.
    for (const s of A.slots) if (s.area === 'hall' && s.crate && s.x > A.hall!.x) s.crate = null;
    const hall0 = A.fill('hall').used;
    run(sim, ARSENAL.convoy.dispatchEvery + 1);
    expect(A.stats.requests).toBe(1);
    expect(A.flightIn).toBeLessThanOrEqual(ARSENAL.flight.lead);
    expect(until(sim, ARSENAL.flight.lead + 10, () => A.stats.delivered > 0)).toBe(true);
    expect(onPad(sim)).toBeGreaterThan(5);
    expect(A.receiving).toBe(true);
    run(sim, 8);
    expect(Math.hypot(qm.x - A.receiveSpot!.x, qm.y - A.receiveSpot!.y)).toBeLessThan(48);
    // Ящики уходят с крыльца в ячейки; кладовщик возвращается за стол.
    expect(until(sim, 200, () => onPad(sim) === 0)).toBe(true);
    expect(A.fill('hall').used).toBeGreaterThan(hall0 + 3);
    expect(A.stats.stored).toBeGreaterThan(5);
    expect(ls.every((c) => c.money > 25)).toBe(true);
    run(sim, 20);
    expect(A.receiving).toBe(false);
    expect(Math.hypot(qm.x - A.deskSpot!.x, qm.y - A.deskSpot!.y)).toBeLessThan(40);
  });

  test('выдача у окна — с расходного стеллажа; грузчик подносит новый ящик из зала', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const unit = createCharacter(sim.entities, sim.ctx.rng, 'cp', A.window!.x, A.window!.y, false, CP_UNIT.su3);
    unit.inventory.add('m4a4', 1);
    expect(A.issue(unit)).not.toBeNull();
    quartermaster(sim);
    run(sim, 1);
    const shelfAmmo = () => A.slots.filter((s) => s.area === 'shelf' && s.crate?.kind === 'ammo').length;
    const n0 = shelfAmmo();
    const hall0 = A.fill('hall').used;
    // Ящик на стеллаже — на perCrate.ammo бойцов; потом пустой ящик убирают.
    for (let k = 0; k < ARSENAL.perCrate.ammo; k++) {
      unit.inventory.remove('ammo_556', unit.inventory.count('ammo_556'));
      expect(A.issue(unit)).toBeNull();
      expect(unit.inventory.count('ammo_556')).toBeGreaterThan(0);
    }
    expect(shelfAmmo()).toBe(n0 - 1);
    worker(sim, 'loader');
    expect(until(sim, 120, () => shelfAmmo() === n0)).toBe(true);
    expect(A.stats.restocked).toBeGreaterThan(0);
    expect(A.fill('hall').used).toBe(hall0 - 1);
  });

  test('возрождение: ГО города выходит с пистолетом и сам идёт за табельным к окну; часовой КПП — от Цитадели', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    quartermaster(sim);
    const pat = spawnRole(sim.ctx, cp('patrol', 'pcu1'), A.waitSpot!)!;
    expect(pat.inventory.has('mp7')).toBe(true);
    A.kitOnRespawn(pat);
    expect(pat.inventory.has('mp7')).toBe(false);
    expect(pat.inventory.has('usp')).toBe(true);
    expect(A.missingKit(pat)).toBe(true);
    expect(A.needsKit(pat)).toBe(true);
    const guns0 = A.stock.weapons;
    expect(until(sim, 100, () => pat.inventory.has('mp7'))).toBe(true);
    expect(pat.inventory.count('ammo_smg')).toBeGreaterThan(0);
    expect(A.stats.issued).toBeGreaterThan(0);
    expect(A.stock.weapons).toBe(guns0 - 1);
    // Часовой КПП склад не трогает.
    const f = sim.war.fronts[0];
    const guard = spawnRole(sim.ctx, cp('guard', 'su3', { front: f.index, post: f.posts[0], facing: 0 }), f.posts[0])!;
    const g0 = guard.inventory.count('ammo_556');
    A.kitOnRespawn(guard);
    expect(guard.inventory.count('ammo_556')).toBe(g0);
  });

  test('пункт боепитания КПП: часовой пополняется у пункта; пункт пустеет — конвой грузчика с охраной', { timeout: 180_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    const A = sim.arsenal;
    expect(A.points.length).toBe(sim.war.fronts.length);
    const p = A.points[0];
    const f = sim.war.fronts[p.front];
    const guard = spawnRole(sim.ctx, cp('guard', 'su3', { front: f.index, post: f.posts[0], facing: 0 }), f.posts[0])!;
    guard.inventory.remove('ammo_556', guard.inventory.count('ammo_556'));
    expect(A.needsPoint(guard, p.front)).toBe(true);
    const k0 = p.kits;
    expect(A.drawAtPoint(guard, p.front)).toBeNull();
    expect(guard.inventory.count('ammo_556')).toBeGreaterThan(0);
    expect(p.kits).toBe(k0 - 1);
    // Конвой: пункт почти пуст.
    p.kits = 2;
    for (const post of A.posts) spawnRole(sim.ctx, cp('depot', 'guard', { post, facing: post.facing }), post);
    worker(sim, 'loader');
    run(sim, ARSENAL.convoy.dispatchEvery + 1);
    expect(A.stats.convoys).toBe(1);
    // Охранник склада идёт с грузчиком конвоя.
    expect(until(sim, 20, () => !!A.convoys[0]?.escort)).toBe(true);
    expect(A.convoys[0].escort!.role?.kind).toBe('depot');
    expect(until(sim, 200, () => p.kits > 2)).toBe(true);
    expect(A.stats.convoyCrates).toBeGreaterThan(0);
    expect(sim.log.some((l) => l.includes('конвой'))).toBe(true);
  });

  test('смена: патрульная группа вызвана на склад и отмечается у окна', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 40);
    sim.war.command.paused = true;
    const A = sim.arsenal;
    run(sim, ARSENAL.shift.first + 1);
    expect(A.stats.shifts).toBe(1);
    expect(sim.log.some((l) => l.includes('сдать смену'))).toBe(true);
    expect(until(sim, ARSENAL.shift.window, () => A.stats.shiftChecks + A.stats.issued > 0)).toBe(true);
  });

  test('красный код — рейсов нет; сломан маяк — борт уходит без разгрузки, грузчик чинит маяк', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const admin = createCharacter(sim.entities, sim.ctx.rng, 'admin', A.waitSpot!.x, A.waitSpot!.y, false, 0);
    expect(sim.war.setCode('red', admin)).toBeNull();
    run(sim, ARSENAL.flight.first + 10);
    expect(A.stats.flights).toBe(0);
    expect(A.ship.phase).toBe('none');
    expect(sim.war.setCode('green', admin)).toBeNull();
    A.breakBeacon();
    run(sim, 25);
    expect(A.stats.flights).toBe(1);
    expect(A.stats.aborted).toBe(1);
    expect(A.crates.length).toBe(0);
    expect(sim.log.some((l) => l.includes('Рейс сорван'))).toBe(true);
    worker(sim, 'loader');
    expect(until(sim, 60, () => !A.beaconBroken)).toBe(true);
    expect(A.stats.repairedBeacon).toBe(1);
  });

  test('инспекция: недостача после кражи — тревога и выдача закрыта; сходится — ничего', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    quartermaster(sim);
    const insp = spawnRole(sim.ctx, cp('inspector', 'insp'), A.ledgerSpot!)!;
    expect(A.inspect(insp)).toBe(0);
    expect(A.closed).toBe(false);
    const s = A.slots.find((q) => q.area === 'hall' && q.crate)!;
    const thief = createCharacter(sim.entities, sim.ctx.rng, 'rebel', s.ax, s.ay, false, 0);
    expect(A.steal(thief)).toBe('ammo');
    expect(A.inspect(insp)).toBe(1);
    expect(A.closed).toBe(true);
    expect(A.stats.shortages).toBe(1);
    const unit = createCharacter(sim.entities, sim.ctx.rng, 'cp', A.window!.x, A.window!.y, false, CP_UNIT.pcu3);
    expect(A.issue(unit)).not.toBeNull();
    expect(sim.log.some((l) => l.includes('недостача'))).toBe(true);
  });

  test('инспектор в обходе сам сверяет опись у стола', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const insp = spawnRole(sim.ctx, cp('inspector', 'insp'), A.ledgerSpot!)!;
    const b = insp.brain as unknown as { dutySpot: unknown; dutyUntil: number; dutyArrived: boolean; fsm: { change(s: string): void } };
    b.dutySpot = { ...A.ledgerSpot! };
    b.dutyUntil = sim.law.now + 60;
    b.fsm.change('duty');
    run(sim, ARSENAL.inspect.check + 3);
    expect(A.stats.inspections).toBe(1);
  });

  test('оружейник: ствол из консервации — за верстак — на стойку; брак в патронах — осечки, проверка списывает', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const racks0 = A.fill('rack').used;
    const parts0 = A.stock.parts;
    worker(sim, 'armorer', A.benchSpot!);
    expect(until(sim, 90, () => A.stats.repaired > 0)).toBe(true);
    expect(until(sim, 60, () => A.fill('rack').used === racks0 + 1)).toBe(true);
    expect(A.stock.parts).toBeLessThan(parts0);
    // Брак: осечки у стрелка.
    const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', A.hall!.x, A.hall!.y, false, CP_UNIT.su3);
    c.inventory.add('mp7', 1);
    c.inventory.add('ammo_smg', 900);
    sim.combat.equip(c, 'mp7');
    c.badAmmo = true;
    for (let k = 0; k < 400; k++) {
      c.nextShot = 0;
      c.reloadUntil = 0;
      c.mag = Math.max(c.mag, 5);
      sim.combat.fire(c, c.x + 100, c.y);
    }
    expect(sim.combat.jams).toBeGreaterThan(10);
    // Весь зал с браком, ремонтировать нечего — оружейник проверяет ящики и списывает брак.
    for (const s of A.slots) {
      if (s.area === 'hall' && s.crate) s.crate.tainted = true;
      if (s.area === 'repair') s.crate = null;
    }
    const tainted0 = A.tainted;
    expect(until(sim, 150, () => A.stats.caught > 0)).toBe(true);
    expect(A.tainted).toBeLessThan(tainted0);
    expect(A.stats.checked).toBeGreaterThan(0);
  });

  test('игрок-грузчик: E — взять ящик с крыльца, E у стеллажа зала — поставить и получить плату', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const p = createCharacter(sim.entities, sim.ctx.rng, 'cwu', A.pad!.x, A.pad!.y, true, 0);
    A.crates.push({ id: 999, kind: 'ammo', left: ARSENAL.perCrate.ammo, tainted: false, broken: false, checked: false, x: p.x + 8, y: p.y });
    expect(A.playerTake(p, 30)).not.toBeNull();
    expect(p.carrying).toBe(true);
    const free = A.slots.find((s) => s.area === 'hall' && !s.crate)!;
    p.x = free.ax;
    p.y = free.ay;
    const money = p.money;
    A.playerPut(p, 30);
    expect(p.carrying).toBe(false);
    expect(A.stats.stored).toBe(1);
    expect(p.money).toBe(money + ARSENAL.work.payStore);
  });

  test('подрыв: заряд у двери зала — через fuse с взрыв, часть ящиков зала сгорает', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const p = createCharacter(sim.entities, sim.ctx.rng, 'rebel', A.bombSpot!.x, A.bombSpot!.y, false, 0);
    expect(A.plantBomb(p)).toBe(false);
    p.inventory.add('grenade', 1);
    const hall = A.fill('hall').used;
    expect(A.plantBomb(p)).toBe(true);
    run(sim, ARSENAL.bomb.fuse + 1);
    expect(A.stats.bombs).toBe(1);
    expect(A.fill('hall').used).toBe(hall - Math.round(hall * ARSENAL.bomb.destroy));
    expect(sim.log.some((l) => l.includes('Взрыв на складе'))).toBe(true);
  });

  test('подполье: партизан в робе грузчика через люк идёт на склад и делает дело', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.insurgency.populate();
    const A = sim.arsenal;
    const op = sim.insurgency.startOperation('depot');
    expect(op?.kind).toBe('depot');
    const c = op!.team[0];
    expect(c.cover?.profession).toBe('loader');
    const done = until(sim, 400, () => A.stats.stolen + A.stats.tainted + A.stats.bombs + (A.beaconBroken ? 1 : 0) + (A.bomb ? 1 : 0) > 0);
    expect(done).toBe(true);
  });

  test('спецагент в форме ГО «по наряду» получает гранаты у окна — в описи, не недостача', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    quartermaster(sim);
    run(sim, 1);
    const agent = createCharacter(sim.entities, sim.ctx.rng, 'rebel', A.window!.x, A.window!.y, false, 0);
    expect(A.requisition(agent)).toBe(ARSENAL.requisition.grenades);
    expect(agent.inventory.count('grenade')).toBe(ARSENAL.requisition.grenades);
    const insp = createCharacter(sim.entities, sim.ctx.rng, 'cp', A.ledgerSpot!.x, A.ledgerSpot!.y, false, CP_UNIT.insp);
    expect(A.inspect(insp)).toBe(0);
  });
});
