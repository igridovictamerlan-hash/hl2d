import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { canManage, demotePlan, lowerUnits, orgCrimes, orgOrder, orgStaff, orgSummary, orgWanted, promoteSlot } from '../src/systems/CpOrg';
import { CP_UNIT, cpUnit, type CpUnitId } from '../src/config/factions';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) sim.step();
}

/** Город с силовым блоком; должности не разбираются сами (Staffing.enabled — выкл.), война стоит. */
function setup(): Sim {
  const sim = makeSim(12345);
  sim.war.command.paused = true;
  sim.insurgency.paused = true;
  spawnPopulation(sim.ctx, 10);
  sim.ctx.staffing.enabled = false;
  run(sim, 5);
  return sim;
}

const units = (sim: Sim, u: CpUnitId): Character[] => sim.entities.list.filter((c) => c.alive && c.faction === 'cp' && c.rank === CP_UNIT[u] && !c.cadet);

describe('меню организации ВС', () => {
  test('сводка, преступления и ориентировки: вызовы, дела, розыск по степени, штат', () => {
    const sim = setup();
    const ctx = sim.ctx;
    const s0 = orgSummary(ctx);
    expect(s0.slots).toBeGreaterThan(20);
    expect(s0.staffed).toBe(s0.slots);
    expect(s0.vacancies).toBe(0);
    // Вызов по рации и разыскиваемый по особо тяжкой — в сводке и в списках.
    const c = sim.entities.list.find((o) => o.alive && o.faction === 'citizen' && !o.law.wanted)!;
    ctx.war.raiseAlarm(c.x, c.y, 'вооружённый на улице', false, { kind: 'armed', suspect: c });
    ctx.law.declare(c, 'murder');
    const s = orgSummary(ctx);
    expect(s.calls).toBeGreaterThanOrEqual(1);
    expect(s.wanted[2]).toBeGreaterThanOrEqual(1);
    const crimes = orgCrimes(ctx);
    expect(crimes.some((k) => k.kind === 'call' && k.title.includes('вооружённый'))).toBe(true);
    const w = orgWanted(ctx);
    expect(w[0].level).toBe(3);
    expect(w.some((o) => o.name === c.name && o.charge === 'убийство')).toBe(true);
    // Погиб юнит — его должность в вакансиях.
    const p3 = units(sim, 'pcu3')[0];
    sim.combat.kill(p3, null);
    expect(orgSummary(ctx).vacancies).toBe(1);
  });

  test('приказы о составе: командир (PCU.OFC и выше) — только тех, кто ниже; повысить — на вакансию, не до своего уровня', () => {
    const sim = setup();
    const ctx = sim.ctx;
    const S = ctx.staffing;
    const [ofc, ofc2] = units(sim, 'ofc');
    const sgt = units(sim, 'pcu1')[0] ?? units(sim, 'pcu2')[0];
    const p3 = units(sim, 'pcu3').find((c) => S.free(c))!;
    expect(ofc && p3 && sgt).toBeTruthy();
    expect(canManage(ofc, p3)).toBe(true);
    // Ниже офицера — приказов не отдаёт; старшего или равного — не трогает.
    expect(canManage(sgt, p3)).toBe(false);
    if (ofc2) expect(canManage(ofc, ofc2)).toBe(false);
    const insp = units(sim, 'insp')[0];
    if (insp) expect(canManage(ofc, insp)).toBe(false);
    // Вакансии PCU.02 нет — повысить некуда.
    expect(promoteSlot(ctx, ofc, p3)).toBeNull();
    expect(orgOrder(ctx, ofc, p3, 'promote')).toContain('Нет свободной должности');
    // Погиб PCU.02 — освободилась его должность: PCU.03 повышают на неё.
    const p2 = units(sim, 'pcu2')[0];
    const post = S.slotOf(p2)!;
    sim.combat.kill(p2, null);
    expect(promoteSlot(ctx, ofc, p3)).toBe(post);
    const msg = orgOrder(ctx, ofc, p3, 'promote');
    expect(msg).toContain('повышен');
    expect(cpUnit(p3.rank).unit).toBe('pcu2');
    expect(S.slotOf(p3)).toBe(post);
    expect(sim.log.some((l) => l.includes('повышен до PCU.02') && l.includes(`приказ ${cpUnit(ofc.rank).short} ${ofc.name}`))).toBe(true);
    // До своего уровня (офицер) — не повышает, даже если вакансия есть.
    if (ofc2) {
      sim.combat.kill(ofc2, null);
      const pcu1 = units(sim, 'pcu1').find((c) => S.free(c));
      if (pcu1) expect(promoteSlot(ctx, ofc, pcu1)).toBeNull();
    }
    // В списке штата — кнопки у тех, кем командует.
    const staff = orgStaff(ctx, ofc);
    expect(staff.length).toBeGreaterThan(20);
    expect(staff[0].command).toBeGreaterThanOrEqual(staff[staff.length - 1].command);
    expect(staff.find((m) => m.id === ofc.id)?.demote).toBeNull();
  });

  test('понижают только ниже по уровню командования: SU.02 — не в PCU.02 того же уровня, а через ступень', () => {
    for (const u of ['su2', 'su3', 'pcu2', 'ofc', 'insp', 'instr'] as const) {
      const low = lowerUnits(u);
      expect(low.length).toBeGreaterThan(0);
      for (const l of low) expect(cpUnit(CP_UNIT[l]).command).toBeLessThan(cpUnit(CP_UNIT[u]).command);
    }
    expect(lowerUnits('rct')).toEqual([]);
    expect(lowerUnits('pcu2')).toEqual(['pcu3']);
  });

  test('понизить: на свободную младшую должность, нет её — обмен с лучшим из младших', () => {
    const sim = setup();
    const ctx = sim.ctx;
    const S = ctx.staffing;
    const ofc = units(sim, 'ofc')[0];
    const p2 = units(sim, 'pcu2').find((c) => S.free(c))!;
    const own = S.slotOf(p2)!;
    // Свободной должности PCU.03 нет — меняют местами с лучшим свободным PCU.03.
    const plan = demotePlan(ctx, ofc, p2)!;
    expect(plan.swap).not.toBeNull();
    const swap = plan.swap!;
    const msg = orgOrder(ctx, ofc, p2, 'demote');
    expect(msg).toContain('понижен');
    expect(cpUnit(p2.rank).unit).toBe('pcu3');
    expect(cpUnit(swap.rank).unit).toBe('pcu2');
    expect(S.slotOf(swap)).toBe(own);
    expect(sim.log.some((l) => l.includes('понижен до PCU.03'))).toBe(true);
    // RCT ниже некуда.
    const rct = units(sim, 'rct').find((c) => S.free(c));
    if (rct) expect(orgOrder(ctx, ofc, rct, 'demote')).toContain('некуда');
    // Свободная младшая должность есть — туда, без обмена.
    const p3 = units(sim, 'pcu3').find((c) => c !== p2 && S.free(c))!;
    sim.combat.kill(p3, null);
    const p2b = units(sim, 'pcu2').find((c) => c !== swap && S.free(c));
    if (p2b) {
      const plan2 = demotePlan(ctx, ofc, p2b)!;
      expect(plan2.swap).toBeNull();
    }
  });
});
