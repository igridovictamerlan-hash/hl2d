import { describe, expect, it } from 'vitest';
import { CP_KITS, UNIFORM_PIECES, kitFrom, unitKit } from '../src/config/uniforms';
import { CP_UNIT, colorsOf, type CpUnitId } from '../src/config/factions';
import { CLOTH_ITEMS } from '../src/config/clothes';
import { GEAR, ITEMS } from '../src/config/items';
import { createCharacter } from '../src/entities/factory';
import { issueUniform, takeOff, wear } from '../src/systems/Gear';
import { armorOf } from '../src/systems/wounds';
import { drawPawn, type PawnDir, type PawnLook } from '../src/entities/PawnRenderer';
import { makeSim } from './simHarness';

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
const UNITS = Object.keys(CP_KITS) as CpUnitId[];

describe('форма по частям', () => {
  it('каждая часть формы — предмет снаряжения своего слота; у юнита — не больше одной части на слот', () => {
    for (const [id, p] of Object.entries(UNIFORM_PIECES)) {
      const g = ITEMS[id as keyof typeof UNIFORM_PIECES].gear;
      expect(g?.slot, id).toBe(p.slot);
      expect(g?.kit, id).toBeTruthy();
    }
    for (const u of UNITS) {
      const slots = CP_KITS[u].map((id) => UNIFORM_PIECES[id].slot);
      expect(new Set(slots).size, u).toBe(slots.length);
      expect(unitKit(u)).toEqual(kitFrom(CP_KITS[u]));
    }
    // Шинель, шлем спецотряда, накидка — отдельные вещи.
    expect(CP_KITS.insp).toContain('un_greatcoat');
    expect(CP_KITS.su3).toContain('un_recon_helmet');
    expect(CP_KITS.epu).toContain('un_cape');
  });

  it('форма каждого юнита и смешанные наряды рисуются со всех сторон, save/restore парные', () => {
    const scarf = CLOTH_ITEMS.find((it) => it.fashion.id === 'scarf')!.piece;
    const fedora = CLOTH_ITEMS.find((it) => it.fashion.id === 'fedora')!.piece;
    const looks: PawnLook[] = UNITS.map((u) => ({ faction: 'cp', rank: CP_UNIT[u], color: colorsOf('cp', CP_UNIT[u]).color, seed: 5 }));
    looks.push({ faction: 'cp', rank: CP_UNIT.insp, color: '#2f7fa0', seed: 6, kit: kitFrom(['un_cp_shirt', 'un_recon_armor_insp']), clothes: { tier: 'middle', top: 'tee', topColor: '#555', bare: true, ...scarf, ...fedora } });
    looks.push({ faction: 'citizen', rank: 0, color: '#6a6f75', seed: 7, kit: kitFrom(['helmet_cp', 'un_gasmask', 'un_greatcoat']), clothes: { tier: 'poor', top: 'sweater', topColor: '#5a5248' } });
    for (const look of looks) {
      for (const dir of DIRS) {
        const { ctx, calls } = fakeCtx();
        expect(() => drawPawn(ctx, look, 0, 0, 2, dir)).not.toThrow();
        expect(calls.get('save')).toBe(calls.get('restore'));
        expect(calls.get('fill') ?? 0).toBeGreaterThan(5);
      }
    }
  });

  it('игроку ВС форма выдаётся по частям: снял каску — голова открыта; повышение — новая форма, шляпа в рюкзак', () => {
    const sim = makeSim(4242);
    const p = createCharacter(sim.entities, sim.ctx.rng, 'cp', 100, 100, true, CP_UNIT.pcu3);
    issueUniform(p, 'pcu3');
    expect(p.gear.head).toBe('helmet_cp');
    expect(p.gear.face).toBe('un_gasmask');
    expect(p.gear.top).toBe('un_cp_shirt');
    expect(p.gear.torso).toBe('un_flak_vest');
    expect(p.kit?.head).toBe('flak');
    expect(armorOf(p).head).toBeCloseTo(0.35);
    expect(armorOf(p).torso).toBeCloseTo(0.4);
    expect(takeOff(p, 'head')).toBeNull();
    expect(p.kit?.head).toBeUndefined();
    expect(armorOf(p).head).toBeCloseTo(UNIFORM_PIECES.un_gasmask.head);
    expect(takeOff(p, 'face')).toBeNull();
    expect(armorOf(p).head).toBe(0);
    // Шляпа из ателье вместо каски — на голове, форма остальная на месте.
    const hat = CLOTH_ITEMS.find((it) => it.fashion.id === 'fedora')!;
    p.inventory.add(hat.id, 1);
    expect(wear(p, hat.id)).toBeNull();
    expect(p.kit?.armor).toBe('flak');
    // Повышение до офицера: фуражка в слот убора, шляпа — в рюкзак; каски и противогаза у офицера нет.
    p.rank = CP_UNIT.ofc;
    issueUniform(p, 'ofc');
    expect(p.gear.hat).toBe('un_peaked_cap');
    expect(p.gear.torso).toBe('un_flak_vest_ofc');
    expect(p.inventory.has(hat.id)).toBe(true);
    expect(p.kitUnit).toBe('ofc');
  });

  it('с тела стражника снимается его форма по частям', () => {
    const sim = makeSim(4243);
    const was = GEAR.dropChance;
    (GEAR as { dropChance: number }).dropChance = 1;
    try {
      const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', 100, 100, false, CP_UNIT.insp);
      sim.combat.kill(c, null);
      const body = sim.combat.corpses[sim.combat.corpses.length - 1];
      for (const id of CP_KITS.insp) expect(body.loot.some((s) => s.id === id), id).toBe(true);
    } finally {
      (GEAR as { dropChance: number }).dropChance = was;
    }
  });
});
