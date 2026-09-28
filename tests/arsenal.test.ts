import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { generateCity, validateMap } from '../src/world/generator/CityGenerator';
import { spawnRole, type RoleSpec } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { ARSENAL } from '../src/config/arsenal';
import { CP_UNIT } from '../src/config/factions';
import { T } from '../src/world/tiles';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * 60; i++) sim.step();
}

const cp = (kind: RoleSpec['kind'], unit: keyof typeof CP_UNIT, extra: Partial<RoleSpec> = {}): RoleSpec => ({ kind, faction: 'cp', profession: null, division: 'su', rank: CP_UNIT[unit], kit: unit === 'qm' ? 'cp_qm' : 'cp', ...extra });

/** Кладовщик за столом (лицом к окну). */
function quartermaster(sim: Sim): Character {
  const A = sim.arsenal;
  return spawnRole(sim.ctx, cp('qm', 'qm', { post: A.desk!, facing: 0 }), A.desk!)!;
}

function loaders(sim: Sim, n: number): Character[] {
  const A = sim.arsenal;
  const out: Character[] = [];
  for (let k = 0; k < n; k++) out.push(spawnRole(sim.ctx, { kind: 'cwu', faction: 'cwu', profession: 'loader', division: null, rank: 0, kit: 'cwu' }, A.waitSpot!)!);
  return out;
}

describe('склад Альянса', () => {
  test('генератор: склад на окраине, двери выходят на улицу-ветку (не в переулок), все точки на месте', () => {
    for (const seed of [12345, 7919, 2024]) {
      const map = generateCity(seed);
      expect(validateMap(map), `сид ${seed}`).toEqual([]);
      const a = map.poisOf('arsenal')[0];
      expect(a, `сид ${seed}`).toBeTruthy();
      expect(map.zones.some((z) => z.kind === 'arsenal')).toBe(true);
      expect(map.poisOf('arsenal_drop')).toHaveLength(8);
      expect(map.poisOf('arsenal_post')).toHaveLength(4);
      expect(map.poisOf('arsenal_window')).toHaveLength(2);
      // Каждая наружная дверь сразу выходит на асфальт проезда.
      let doors = 0;
      for (let y = a.y; y < a.y + a.h!; y++) {
        for (let x = a.x; x < a.x + a.w!; x++) {
          if (map.tileAt(x, y) !== T.DOOR) continue;
          const d = x === a.x ? [-1, 0] : x === a.x + a.w! - 1 ? [1, 0] : y === a.y ? [0, -1] : y === a.y + a.h! - 1 ? [0, 1] : null;
          if (!d) continue;
          doors++;
          expect(map.tileAt(x + d[0], y + d[1]), `сид ${seed}, дверь ${x},${y}`).toBe(T.STREET);
        }
      }
      expect(doors).toBeGreaterThanOrEqual(4);
      // Окраина: до главного проспекта далеко.
      let best = Infinity;
      const cx = a.x + a.w! / 2;
      const cy = a.y + a.h! / 2;
      for (let y = 0; y < map.height; y += 2) {
        for (let x = 0; x < map.width; x += 2) {
          if (map.zoneAtTile(x, y)?.name === 'Главный проспект') best = Math.min(best, Math.hypot(x - cx, y - cy));
        }
      }
      expect(best, `сид ${seed}`).toBeGreaterThan(30);
    }
  });

  test('борт из Цитадели: контейнер на площадку, грузчики носят ящики в зал, опись по накладной, погрузка для КПП', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    expect(A.present).toBe(true);
    loaders(sim, 2);
    const before = { ...A.stock };
    run(sim, ARSENAL.flight.first + ARSENAL.flight.arrive + 1);
    expect(A.stats.flights).toBe(1);
    expect(A.stats.delivered).toBe(1);
    expect(A.crates.filter((c) => c.dir === 'in').length).toBeGreaterThan(10);
    expect(A.ledger.ammo).toBe(before.ammo + ARSENAL.manifest.ammo);
    run(sim, 90);
    expect(A.stats.hauled).toBeGreaterThanOrEqual(15);
    expect(A.stock.ammo).toBeGreaterThan(before.ammo);
    // Ящики для гарнизонов КПП ждут борт на площадке.
    expect(A.stats.loaded).toBeGreaterThan(0);
    expect(A.crates.some((c) => c.dir === 'out')).toBe(true);
    // Грузчикам платят за ящики.
    expect(sim.entities.list.filter((c) => c.profession === 'loader').every((c) => c.money > 25)).toBe(true);
  });

  test('выдача у окна: без кладовщика — отказ; с ним — патроны и гранаты из запасов; ГО сам идёт пополниться', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const unit = createCharacter(sim.entities, sim.ctx.rng, 'cp', A.window!.x, A.window!.y, false, CP_UNIT.su3);
    expect(A.issue(unit)).not.toBeNull();
    quartermaster(sim);
    run(sim, 1);
    unit.inventory.add('m4a4', 1);
    const ammo0 = A.stock.ammo;
    expect(A.issue(unit)).toBeNull();
    expect(unit.inventory.count('ammo_556')).toBeGreaterThan(0);
    expect(A.stock.ammo).toBe(ammo0 - 1);
    // Один ящик — на perCrate.ammo бойцов: ещё двое — из того же ящика.
    for (let k = 1; k < ARSENAL.perCrate.ammo; k++) A.issue(unit);
    expect(A.stock.ammo).toBe(ammo0 - 1);
    // Патрульный без патронов сам идёт к окну и получает боекомплект.
    const pat = spawnRole(sim.ctx, cp('patrol', 'pcu3', { division: 'pcu' }), A.waitSpot!)!;
    pat.inventory.remove('ammo_pistol', pat.inventory.count('ammo_pistol'));
    run(sim, 60);
    expect(pat.inventory.count('ammo_pistol')).toBeGreaterThan(0);
    expect(A.stats.issued).toBeGreaterThanOrEqual(ARSENAL.perCrate.ammo + 1);
  });

  test('возрождение: ГО города — набор со склада, пусто — патронов по минимуму; гарнизон КПП — от Цитадели', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const pat = spawnRole(sim.ctx, cp('patrol', 'pcu3', { division: 'pcu' }), A.waitSpot!)!;
    const s0 = A.stock.ammo;
    A.kitOnRespawn(pat);
    // Открыт ящик: минус ящик из запасов, в нём ещё perCrate − 1 боекомплектов.
    expect(A.stock.ammo).toBe(s0 - 1);
    expect(A.openAmmo).toBe(ARSENAL.perCrate.ammo - 1);
    // Склад пуст.
    A.stock.ammo = 0;
    A.openAmmo = 0;
    const poor = spawnRole(sim.ctx, cp('patrol', 'pcu3', { division: 'pcu' }), A.waitSpot!)!;
    const full = poor.inventory.count('ammo_pistol');
    A.kitOnRespawn(poor);
    expect(poor.inventory.count('ammo_pistol')).toBeLessThan(full);
    expect(A.stats.poorKits).toBe(1);
    // Часовой КПП склад не трогает.
    const f = sim.war.fronts[0];
    const guard = spawnRole(sim.ctx, { ...cp('guard', 'su3', { front: f.index, post: f.posts[0], facing: 0 }), kit: 'cp_su' }, f.posts[0])!;
    const g0 = guard.inventory.count('ammo_556');
    A.kitOnRespawn(guard);
    expect(guard.inventory.count('ammo_556')).toBe(g0);
    expect(A.stats.poorKits).toBe(1);
  });

  test('красный код — рейсов нет; сломан маяк — борт уходит без разгрузки', { timeout: 60_000 }, () => {
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
  });

  test('инспекция: недостача после кражи — тревога и выдача закрыта; сходится — ничего', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    quartermaster(sim);
    const insp = spawnRole(sim.ctx, cp('inspector', 'insp'), A.ledgerSpot!)!;
    expect(A.inspect(insp)).toBe(0);
    expect(A.closed).toBe(false);
    const thief = createCharacter(sim.entities, sim.ctx.rng, 'rebel', A.hallSpot!.x, A.hallSpot!.y, false, 0);
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

  test('брак в патронах: осечки; оружейник находит брак', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', A.hallSpot!.x, A.hallSpot!.y, false, CP_UNIT.su3);
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
    // Оружейник: брак списан.
    A.tainted = 3;
    const arm = spawnRole(sim.ctx, { kind: 'cwu', faction: 'cwu', profession: 'armorer', division: null, rank: 0, kit: 'cwu' }, A.benchSpot!)!;
    for (let k = 0; k < 20; k++) A.benchWork(arm, ARSENAL.armorer.every);
    expect(A.tainted).toBeLessThan(3);
    expect(A.stats.caught).toBeGreaterThan(0);
  });

  test('подрыв: заряд у двери зала — через fuse с взрыв, половина запасов сгорает', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    const p = createCharacter(sim.entities, sim.ctx.rng, 'rebel', A.bombSpot!.x, A.bombSpot!.y, false, 0);
    expect(A.plantBomb(p)).toBe(false);
    p.inventory.add('grenade', 1);
    const ammo = A.stock.ammo;
    expect(A.plantBomb(p)).toBe(true);
    run(sim, ARSENAL.bomb.fuse + 1);
    expect(A.stats.bombs).toBe(1);
    expect(A.stock.ammo).toBe(ammo - Math.round(ammo * ARSENAL.bomb.destroy));
    expect(sim.log.some((l) => l.includes('Взрыв на складе'))).toBe(true);
  });

  test('подполье: партизан в робе грузчика через люк идёт на склад и возвращается', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.insurgency.populate();
    const A = sim.arsenal;
    const op = sim.insurgency.startOperation('depot');
    expect(op?.kind).toBe('depot');
    const c = op!.team[0];
    expect(c.cover?.profession).toBe('loader');
    let done = false;
    for (let s = 0; s < 400 && !done; s++) {
      run(sim, 1);
      done = A.stats.stolen + A.stats.tainted + A.stats.bombs + (A.beaconBroken ? 1 : 0) + (A.bomb ? 1 : 0) > 0;
    }
    expect(done).toBe(true);
  });

  test('спецагент в форме ГО «по наряду» получает гранаты у окна', () => {
    const sim = makeSim(12345);
    const A = sim.arsenal;
    quartermaster(sim);
    run(sim, 1);
    const agent = createCharacter(sim.entities, sim.ctx.rng, 'rebel', A.window!.x, A.window!.y, false, 0);
    const g = A.stock.grenades;
    expect(A.requisition(agent)).toBe(ARSENAL.requisition.grenades);
    expect(agent.inventory.count('grenade')).toBe(ARSENAL.requisition.grenades);
    // Записано в опись — это не недостача.
    const insp = createCharacter(sim.entities, sim.ctx.rng, 'cp', A.ledgerSpot!.x, A.ledgerSpot!.y, false, CP_UNIT.insp);
    expect(A.inspect(insp)).toBe(0);
    expect(A.stock.grenades).toBe(g - 1);
  });
});
