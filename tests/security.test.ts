import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation, poiWorld } from '../src/systems/Population';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { OtaBrain } from '../src/ai/brains/OtaBrain';
import { CP_UNIT, cpUnit, cpHas } from '../src/config/factions';
import { ROSTER } from '../src/config/roster';
import { SECURITY } from '../src/config/security';
import { createCharacter } from '../src/entities/factory';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;
const run = (sim: Sim, secs: number, until?: () => boolean) => {
  for (let t = 0; t < secs * 60; t++) {
    sim.step();
    if (until?.()) return;
  }
};
const cps = (sim: Sim) => sim.entities.list.filter((c) => c.alive && c.faction === 'cp');
const brain = (c: Character) => c.brain as CpBrain;

describe('силовой блок: PCU, SU, CMD, OTA', () => {
  test('состав: юниты с HP и оружием по таблице; RCT на постах, SU на КПП, OTA.KING и ALPHA', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    const by = (unit: keyof typeof CP_UNIT) => cps(sim).filter((c) => c.rank === CP_UNIT[unit]);
    expect(by('rct')[0].maxHealth).toBe(75);
    expect(by('pcu3')[0].maxHealth).toBe(90);
    expect(by('pcu2')[0].maxHealth).toBe(100);
    expect(by('ofc')[0].maxHealth).toBe(150);
    expect(by('su3')[0].maxHealth).toBe(120);
    expect(by('su2')[0].maxHealth).toBe(125);
    expect(by('ofc')).toHaveLength(ROSTER.cp.officers);
    expect(by('insp')).toHaveLength(ROSTER.cp.inspectors);
    expect(by('epu')).toHaveLength(ROSTER.cp.epu);
    // Охранников меньше, чем целей охраны (инспекторы, глава, Администратор, лоялисты).
    expect(by('guard').length).toBeLessThan(ROSTER.cp.inspectors + ROSTER.cp.epu + 1 + SECURITY.guard.loyalists);
    // Оружие: PCU.03 — пистолет без MP7, сержант и SU.03 — MP7.
    expect(by('pcu3')[0].inventory.has('mp7')).toBe(false);
    expect(by('pcu3')[0].inventory.has('usp')).toBe(true);
    expect(by('pcu1')[0].inventory.has('mp7')).toBe(true);
    expect(by('su3')[0].inventory.has('mp7')).toBe(true);
    // RCT: у ворот Нексуса, в проходных КПП и в людных местах; на постах КПП — только SU.03.
    const rct = by('rct');
    expect(rct.length).toBe(ROSTER.cp.nexusPosts + ROSTER.cp.publicPosts + sim.war.fronts.reduce((n, f) => n + f.gatePosts.length, 0));
    const gate = poiWorld(sim.ctx, 'nexus_gate')!;
    expect(rct.some((c) => Math.hypot(c.x - gate.x, c.y - gate.y) < 100)).toBe(true);
    for (const f of sim.war.fronts) for (const p of f.posts) expect(cps(sim).some((c) => c.rank === CP_UNIT.su3 && brain(c).guardPost === p)).toBe(true);
    // Умения: следователь сканирует тела, SU.02 — медик и сканер.
    expect(cpHas(by('su1')[0], 'investigate')).toBe(true);
    expect(cpHas(by('su2')[0], 'medic') && cpHas(by('su2')[0], 'drone')).toBe(true);
    const ota = sim.entities.list.filter((c) => c.faction === 'ota' && c.brain instanceof OtaBrain);
    expect(ota.filter((c) => c.profession === 'ota_king')).toHaveLength(1);
    expect(ota.filter((c) => c.profession === 'ota_alpha').length).toBeGreaterThan(0);
    expect(ota.find((c) => c.profession === 'ota_alpha')!.maxHealth).toBe(150);
    expect(ota.find((c) => c.profession === 'ota_alpha')!.inventory.has('ar2')).toBe(true);
    // PCU на КПП не ходит.
    const leader = cps(sim).find((c) => brain(c).duty === 'squad' && brain(c).lead)!;
    const kpp = sim.map.zones.find((z) => z.kind === 'checkpoint')!.id;
    expect(brain(leader).patrolAvoid.has(kpp)).toBe(true);
  });

  test('патрульные группы: PCU.03 и следователи идут за ведущим', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    // Ведомый, который сам задержал нарушителя и отвёл его в КПЗ, потом догоняет группу через весь
    // город — это выброс; смотрим медиану расстояния до ведущего.
    const ds: number[] = [];
    run(sim, 90, () => {
      if (sim.ctx.law.now % 1 < 1 / 60) {
        for (const c of cps(sim)) {
          const b = brain(c);
          const l = b.fsm.current === 'follow' ? b.leader() : null;
          if (l) ds.push(Math.hypot(l.x - c.x, l.y - c.y));
        }
      }
      return false;
    });
    ds.sort((a, b) => a - b);
    const median = ds[Math.floor(ds.length / 2)];
    console.log(`ведомых в группах: ${ds.length} замеров, медиана расстояния до ведущего ${median.toFixed(0)} px`);
    expect(ds.length).toBeGreaterThan(100);
    expect(median).toBeLessThan(160);
  });

  test('построение: офицер собирает юнитов PCU на плацу Нексуса и распускает', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    // Без вылазок партизан и дронов: тревога (код жёлтый) распускает строй.
    sim.insurgency.paused = true;
    sim.scanners.update = () => {};
    run(sim, 5);
    expect(sim.security.startFormation()).toBe(true);
    const f = sim.security.formation!;
    expect(f.officer.rank).toBe(CP_UNIT.ofc);
    expect(f.members.every((m) => cpUnit(m.rank).group === 'pcu')).toBe(true);
    let lined = 0;
    run(sim, SECURITY.formation.gather + 5, () => {
      lined = Math.max(lined, f.members.filter((m) => brain(m).formation && Math.hypot(m.x - brain(m).formation!.x, m.y - brain(m).formation!.y) < 20).length);
      return !!f.standUntil;
    });
    expect(lined).toBeGreaterThanOrEqual(Math.min(4, f.members.length));
    run(sim, SECURITY.formation.stand + 2, () => !sim.security.formation);
    expect(sim.security.formation).toBeNull();
    expect(f.members.every((m) => !brain(m).formation)).toBe(true);
  });

  test('охрана по очереди: инспекторы всегда под охраной, остальные цели меняются; глава выходит только с охраной', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    run(sim, 2);
    const guards = cps(sim).filter((c) => brain(c).duty === 'bodyguard');
    const insp = cps(sim).filter((c) => brain(c).duty === 'inspector');
    const wards = new Set<Character>();
    for (let r = 0; r < 4; r++) {
      sim.security.rotateGuards();
      for (const i of insp) expect(guards.some((g) => brain(g).ward === i)).toBe(true);
      for (const g of guards) if (brain(g).ward) wards.add(brain(g).ward!);
    }
    expect(wards.size).toBeGreaterThan(guards.length);
    // Глава силового блока — в Нексусе; на выходе к площади с ним вся охрана.
    const epu = cps(sim).find((c) => brain(c).duty === 'epu')!;
    expect(['nexus', 'cells']).toContain(sim.map.zoneAtWorld(epu.x, epu.y)?.kind);
    (sim.security as unknown as { nextTour: number }).nextTour = 0;
    run(sim, 1);
    expect(sim.security.tourSpot).not.toBeNull();
    for (const g of guards) expect(brain(g).ward).toBe(epu);
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    run(sim, 80, () => Math.hypot(epu.x - plaza.x, epu.y - plaza.y) < 60);
    expect(Math.hypot(epu.x - plaza.x, epu.y - plaza.y)).toBeLessThan(60);
    expect(guards.filter((g) => Math.hypot(g.x - epu.x, g.y - epu.y) < 160).length).toBeGreaterThan(0);
  });

  test('терминал кодов: офицер и выше — да, патрульный — нет', () => {
    const sim = makeSim(12345);
    const pcu = createCharacter(sim.entities, sim.ctx.rng, 'cp', 100, 100, false, CP_UNIT.pcu3);
    const ofc = createCharacter(sim.entities, sim.ctx.rng, 'cp', 100, 100, false, CP_UNIT.ofc);
    const insp = createCharacter(sim.entities, sim.ctx.rng, 'cp', 100, 100, false, CP_UNIT.insp);
    expect(sim.war.canSetCode(pcu)).toBe(false);
    expect(sim.war.canSetCode(ofc)).toBe(true);
    expect(sim.war.canSetCode(insp)).toBe(true);
  });
});
