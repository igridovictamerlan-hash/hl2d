import { describe, it, expect } from 'vitest';
import { makeSim } from './simHarness';
import { spawnRole } from '../src/systems/Roster';
import { CP_UNIT } from '../src/config/factions';
import { WeaponWheel } from '../src/ui/WeaponWheel';
import { HUD } from '../src/config/hud';
import { WEAPONS } from '../src/config/items';

describe('колесо оружия (B1)', () => {
  const setup = () => {
    const sim = makeSim(12345);
    const cp = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, { x: 400, y: 400 })!;
    cp.inventory.add('ak74', 1);
    cp.inventory.add('m4a4', 1);
    cp.inventory.add('grenade', 2);
    cp.inventory.add('smoke_grenade', 1);
    return { sim, cp };
  };
  /** Вектор мыши от центра экрана в середину сектора k. */
  const toward = (k: number) => {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / HUD.wheel.sectors.length;
    return [Math.cos(a) * 120, Math.sin(a) * 120] as const;
  };
  const sector = (name: string) => HUD.wheel.sectors.findIndex((s) => s.name === name);

  it('секторы по классам, листание колесом мыши, отпустить — выбор', () => {
    const { sim, cp } = setup();
    const w = new WeaponWheel();
    w.show(cp, sim.ctx.combat);
    // Винтовки: два ствола — листаются по кругу.
    w.aim(...toward(sector('Винтовки')));
    const first = w.close();
    expect(first?.kind).toBe('weapon');
    w.show(cp, sim.ctx.combat);
    w.aim(...toward(sector('Винтовки')));
    w.scroll(1);
    const second = w.close();
    expect(second?.kind === 'weapon' && first?.kind === 'weapon' && second.id !== first.id).toBe(true);
    for (const c of [first, second]) if (c?.kind === 'weapon') expect(['rifle', 'pulse']).toContain(WEAPONS[c.id].class);
    // Пистолеты — табельный USP.
    w.show(cp, sim.ctx.combat);
    w.aim(...toward(sector('Пистолеты')));
    expect(w.close()).toEqual({ kind: 'weapon', id: 'usp' });
    // Гранаты — выбор вида для T.
    w.show(cp, sim.ctx.combat);
    w.aim(...toward(sector('Гранаты')));
    w.scroll(1);
    const g = w.close();
    expect(g?.kind).toBe('grenade');
    // Ближний бой: дубинка, последним — убрать оружие.
    w.show(cp, sim.ctx.combat);
    w.aim(...toward(sector('Ближний бой')));
    w.scroll(-1);
    expect(w.close()).toEqual({ kind: 'holster' });
  });

  it('мышь в центре — ничего; пустой сектор — ничего', () => {
    const { sim, cp } = setup();
    const w = new WeaponWheel();
    w.show(cp, sim.ctx.combat);
    w.sel = -1;
    w.aim(3, 4);
    expect(w.close()).toBeNull();
    w.show(cp, sim.ctx.combat);
    w.aim(...toward(sector('Тяжёлое')));
    expect(w.close()).toBeNull();
  });

  it('открытое колесо — сектор того, что в руках', () => {
    const { sim, cp } = setup();
    sim.ctx.combat.equip(cp, 'm4a4');
    const w = new WeaponWheel();
    w.show(cp, sim.ctx.combat);
    expect(w.sel).toBe(sector('Винтовки'));
    expect(w.close()).toEqual({ kind: 'weapon', id: 'm4a4' });
  });
});
