import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { poiWorld } from '../src/systems/Population';
import { createCharacter } from '../src/entities/factory';
import { stepPhysics } from '../src/entities/physics';
import { dirWithHysteresis } from '../src/entities/gait';
import { PAWN } from '../src/config/pawns';
import { CP_UNIT, FACTIONS } from '../src/config/factions';
import { accessoriesOf } from '../src/entities/pawnArmor';

/** Пешка на площади (там просторно), без мозга — движение задаём сами. */
function pawn() {
  const sim = makeSim(12345);
  const p = poiWorld(sim.ctx, 'plaza_center')!;
  const a = sim.nav.nearestWalkable(p.x, p.y, 4);
  const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', sim.nav.worldX(a), sim.nav.worldY(a));
  const step = (secs: number) => {
    for (let t = 0; t < secs * 60; t++) stepPhysics(sim.entities, sim.map, 1 / 60);
  };
  return { c, step };
}

describe('походка', () => {
  test('идёт вбок — профиль, а не спина, даже если смотрит вверх; шаги копятся', () => {
    const { c, step } = pawn();
    c.facing = -Math.PI / 2;
    c.wantX = 90;
    step(0.5);
    expect(c.bodyDir).toBe('E');
    expect(c.stride).toBeGreaterThan(20);
    c.wantX = -90;
    step(0.5);
    expect(c.bodyDir).toBe('W');
  });

  test('целится — к цели; стоит — куда смотрит', () => {
    const { c, step } = pawn();
    c.facing = -Math.PI / 2;
    c.wantX = 90;
    c.aiming = true;
    step(0.3);
    expect(c.bodyDir).toBe('N');
    c.aiming = false;
    c.wantX = 0;
    step(0.5);
    expect(c.bodyDir).toBe('N');
    const stride = c.stride;
    step(0.5);
    expect(c.stride).toBe(stride);
  });

  test('на диагонали сторона не мигает (гистерезис)', () => {
    const h = PAWN.walk.hysteresis;
    // 50° вниз-вправо: у «востока» остаётся восток, у «юга» — юг.
    const a = (50 * Math.PI) / 180;
    expect(dirWithHysteresis(a, 'E', h)).toBe('E');
    expect(dirWithHysteresis(a, 'S', h)).toBe('S');
    // Явно вниз — юг, даже если шли на восток.
    expect(dirWithHysteresis(Math.PI / 2, 'E', h)).toBe('S');
  });
});

describe('снаряжение силового блока', () => {
  test('у каждого юнита ГО свой стиль брони по эскизам; OTA — силовая броня', () => {
    const ranks = FACTIONS.cp.ranks!;
    expect(Object.keys(PAWN.cpUnits).sort()).toEqual(ranks.map((r) => r.id).sort());
    expect(PAWN.cpUnits.pcu3.style).toBe('flak');
    expect(PAWN.cpUnits.su3.style).toBe('recon');
    expect(PAWN.cpUnits.epu.style).toBe('marine');
    expect(PAWN.outfits.ota.style).toBe('marine');
    expect(CP_UNIT.ofc).toBeGreaterThan(CP_UNIT.pcu1);
  });

  test('необязательные аксессуары — у части юнитов, обязательные — у всех', () => {
    const O = PAWN.cpUnits.pcu3;
    let radio = 0;
    for (let seed = 1; seed <= 400; seed++) if (accessoriesOf(O, seed * 7919).has('radio')) radio++;
    expect(radio).toBeGreaterThan(400 * PAWN.accChance * 0.6);
    expect(radio).toBeLessThan(400 * PAWN.accChance * 1.4);
    for (let seed = 1; seed <= 50; seed++) expect(accessoriesOf(PAWN.cpUnits.pcu1, seed).has('chevrons')).toBe(true);
  });
});
