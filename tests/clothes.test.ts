import { describe, expect, it } from 'vitest';
import { CLOTHES, CLOTH_ITEMS, atelierStock } from '../src/config/clothes';
import { ITEMS } from '../src/config/items';
import { createCharacter } from '../src/entities/factory';
import { spawnPopulation } from '../src/systems/Population';
import { dressIn, tierRank, wear, wearsClothes } from '../src/systems/Gear';
import { applyToPlayer, capturePlayer } from '../src/systems/SaveGame';
import { makeSim } from './simHarness';
import { bootColor, drawPawn, type PawnDir, type PawnLook } from '../src/entities/PawnRenderer';

/** Холст-заглушка: считает вызовы рисования, свойства принимает молча. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      return (..._args: unknown[]) => { calls.set(String(key), (calls.get(String(key)) ?? 0) + 1); };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const DIRS: PawnDir[] = ['S', 'N', 'E', 'W'];

describe('одежда по достатку', () => {
  it('у каждого достатка по шесть комплектов, коды не повторяются', () => {
    for (const tier of ['poor', 'middle', 'rich'] as const) {
      expect(CLOTHES.sets.filter((s) => s.look.tier === tier)).toHaveLength(6);
    }
    expect(new Set(CLOTHES.sets.map((s) => s.code)).size).toBe(CLOTHES.sets.length);
  });

  it('каждый комплект рисуется со всех сторон, save/restore парные', () => {
    for (const set of CLOTHES.sets) {
      for (const dir of DIRS) {
        const { ctx, calls } = fakeCtx();
        const look: PawnLook = { faction: 'citizen', rank: 0, color: '#6a6f75', seed: set.seed, clothes: set.look };
        expect(() => drawPawn(ctx, look, 0, 0, 2, dir), `${set.code} ${dir}`).not.toThrow();
        expect(calls.get('save'), `${set.code} ${dir}`).toBe(calls.get('restore'));
        expect(calls.get('fill') ?? 0).toBeGreaterThan(5);
      }
    }
  });

  it('обувь — из комплекта, без комплекта — по фракции', () => {
    const set = CLOTHES.sets[0];
    expect(bootColor({ faction: 'citizen', clothes: set.look })).toBe(set.look.boots);
    expect(bootColor({ faction: 'citizen' })).not.toBe(set.look.boots);
  });
});

describe('одежда: вещи, слоты, ателье, горожане', () => {
  const sim = makeSim(12345);
  sim.war.command.paused = true;
  spawnPopulation(sim.ctx, 150);
  const citizen = (x = 0, y = 0) => createCharacter(sim.entities, sim.ctx.rng, 'citizen', x, y, false, 0);
  const cloth = (slot: string, tier: string) => CLOTH_ITEMS.find((it) => it.fashion.slot === slot && it.fashion.tier === tier && !it.fashion.who)!;

  it('каждая вещь каталога — предмет снаряжения своего слота с ценой', () => {
    expect(CLOTH_ITEMS.length).toBeGreaterThan(100);
    for (const it of CLOTH_ITEMS) {
      const g = ITEMS[it.id].gear!;
      expect(g.slot).toBe(it.fashion.slot);
      expect(g.cloth).toBeTruthy();
      expect(ITEMS[it.id].price).toBeGreaterThan(0);
    }
  });

  it('надел низ и верх — пешка в них; бронежилет поверх одежды не снимает её', () => {
    const c = citizen();
    const top = cloth('top', 'middle');
    const outer = cloth('outer', 'middle');
    dressIn(c, top.id);
    dressIn(c, outer.id);
    expect(c.gear.top).toBe(top.id);
    expect(c.clothes?.outer).toBe(outer.fashion.piece.outer);
    expect(c.clothesKey).toContain(outer.id);
    c.inventory.add('vest', 1);
    expect(wear(c, 'vest')).toBeNull();
    expect(c.gear.torso).toBe('vest');
    expect(c.clothes?.outer).toBe(outer.fashion.piece.outer);
    // На пешке поверх одежды — пластины бронежилета: рисунок длиннее.
    const look: PawnLook = { faction: 'citizen', rank: 0, color: '#6a6f75', seed: 3, clothes: c.clothes, clothesKey: c.clothesKey };
    const plain = fakeCtx();
    drawPawn(plain.ctx, look, 0, 0, 2, 'S');
    const armored = fakeCtx();
    drawPawn(armored.ctx, { ...look, vest: '#4a4e44' }, 0, 0, 2, 'S');
    const n = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(n(armored.calls)).toBeGreaterThan(n(plain.calls));
  });

  it('старое сохранение: плащ в слоте корпуса переходит в верх', () => {
    const p = citizen();
    const save = capturePlayer(p, 12345, { faction: 'citizen' } as never, p.name, { explored: new Uint8Array(0), hatches: [] });
    save.gear = { torso: 'coat', head: 'cap' } as never;
    applyToPlayer(p, save);
    expect(p.gear.outer).toBe('coat');
    expect(p.gear.hat).toBe('cap');
    expect(p.gear.torso).toBeUndefined();
  });

  it('два ателье: в центре — бедное и среднее, в Верхнем городе — среднее и богатое', () => {
    const tiers = (sub: string) => new Set(atelierStock(sub).map((id) => ITEMS[id].gear!.tier));
    expect([...tiers('tailor')].sort()).toEqual(['middle', 'poor']);
    expect([...tiers('tailor_up')].sort()).toEqual(['middle', 'rich']);
    const shops = sim.ctx.shops.shops;
    const old = shops.find((s) => s.sub === 'tailor')!;
    const up = shops.find((s) => s.sub === 'tailor_up')!;
    expect(sim.map.districtAtWorld(old.front.x, old.front.y)).toBe('old');
    expect(sim.map.districtAtWorld(up.front.x, up.front.y)).toBe('upper');
    // Одежду возят баржи: на складе штаба ТС она есть с самого начала.
    for (const id of atelierStock('tailor_up')) expect(sim.ctx.supply.count(id)).toBeGreaterThan(0);
  });

  it('горожане одеты по достатку дома: Слобода беднее Верхнего города, в деле роли — тот же комплект', () => {
    const by: Record<string, number[]> = { slum: [], old: [], upper: [] };
    let dressed = 0;
    let total = 0;
    for (const c of sim.entities.list) {
      if (!c.alive || !c.role || !wearsClothes(c)) continue;
      total++;
      if (!c.clothes || !c.gear.top || !c.gear.feet) continue;
      dressed++;
      expect(c.role?.outfit?.length).toBeGreaterThanOrEqual(2);
      const d = sim.ctx.housing.of(c);
      const at = d?.spots[0] ?? c;
      const band = d?.kind === 'villa' ? 'upper' : sim.map.districtAtWorld(at.x, at.y);
      if (band && !CLOTHES.npc.crooks[c.profession ?? '']) by[band].push(tierRank(c.clothes.tier));
    }
    expect(total).toBeGreaterThan(40);
    expect(dressed).toBe(total);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(by.slum.length).toBeGreaterThan(3);
    expect(by.upper.length).toBeGreaterThan(3);
    expect(mean(by.slum)).toBeLessThan(mean(by.upper));
  });

  it('бандиты и воры одеты по-разному, у части капюшон и платок на лице; горожанам блатное не выдаётся', () => {
    const crooks = sim.entities.list.filter((c) => c.alive && (c.profession === 'bandit' || c.profession === 'thief'));
    expect(crooks.length).toBeGreaterThan(5);
    for (const c of crooks) expect(c.clothes).toBeTruthy();
    // Не однотипно: разных комплектов почти столько же, сколько людей.
    expect(new Set(crooks.map((c) => c.clothesKey)).size).toBeGreaterThan(crooks.length * 0.8);
    expect(crooks.some((c) => c.clothes?.hat === 'hood')).toBe(true);
    expect(crooks.some((c) => c.clothes?.neck === 'mask')).toBe(true);
    const plain = sim.entities.list.filter((c) => c.alive && c.profession === 'citizen' && c.clothes);
    for (const c of plain) {
      expect(c.clothes?.hat).not.toBe('hood');
      expect(c.clothes?.neck).not.toBe('mask');
    }
    // Капюшон и платок рисуются со всех сторон.
    for (const dir of DIRS) {
      const { ctx } = fakeCtx();
      drawPawn(ctx, { faction: 'citizen', rank: 0, color: '#888', seed: 7, clothes: { tier: 'poor', top: 'tee', topColor: '#555', hat: 'hood', hatColor: '#2e3137', neck: 'mask', neckColor: '#1d1d1f' } }, 0, 0, 1, dir);
    }
  });

  it('NPC покупает вещь с полки ателье и надевает; богатую вещь не по карману достатку — не берёт', () => {
    const S = sim.ctx.shops;
    const s = S.shops.find((x) => x.sub === 'tailor_up')!;
    const vendor = citizen(s.vendorSpot!.x, s.vendorSpot!.y);
    s.vendor = vendor;
    const buyer = citizen(s.front.x, s.front.y);
    dressIn(buyer, cloth('top', 'middle').id);
    buyer.money = 500;
    buyer.hunger = 100;
    const want = atelierStock('tailor_up').find((id) => ITEMS[id].gear!.slot === 'hat' && ITEMS[id].gear!.tier === 'middle')!;
    for (const id of s.shelf.keys()) s.shelf.set(id, 0);
    s.shelf.set(want, 2);
    expect(S.npcBuy(buyer, s, sim.ctx.rng)).toBe(want);
    expect(buyer.gear.hat).toBe(want);
    expect(s.shelf.get(want)).toBe(1);
    expect(buyer.inventory.has(want)).toBe(false);
    // Богатое — горожанину среднего достатка не по чину.
    const rich = atelierStock('tailor_up').find((id) => ITEMS[id].gear!.tier === 'rich')!;
    for (const id of s.shelf.keys()) s.shelf.set(id, 0);
    s.shelf.set(rich, 2);
    expect(S.npcBuy(buyer, s, sim.ctx.rng)).toBeNull();
    expect(s.shelf.get(rich)).toBe(2);
  });
});

describe('лицо и мимика', () => {
  it('моргнул и говорит — другой рисунок лица, со всех сторон без ошибок', () => {
    const base: PawnLook = { faction: 'citizen', rank: 0, color: '#6a6f75', seed: 4242 };
    const count = (look: PawnLook, dir: PawnDir) => {
      const { ctx, calls } = fakeCtx();
      drawPawn(ctx, look, 0, 0, 2, dir);
      expect(calls.get('save')).toBe(calls.get('restore'));
      return [...calls.values()].reduce((a, b) => a + b, 0);
    };
    for (const dir of DIRS) {
      count(base, dir);
      count({ ...base, blink: true }, dir);
      count({ ...base, talk: true }, dir);
    }
    expect(count({ ...base, blink: true }, 'S')).not.toBe(count(base, 'S'));
    expect(count({ ...base, talk: true }, 'S')).not.toBe(count(base, 'S'));
  });
});
