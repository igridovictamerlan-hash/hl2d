import { afterEach, describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CP_UNIT, cpUnit } from '../src/config/factions';
import { HOSPITAL } from '../src/config/hospital';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { EvacBrain } from '../src/ai/brains/EvacBrain';
import { PatientBrain } from '../src/ai/brains/PatientBrain';
import { CustodyBrain } from '../src/ai/brains/CustodyBrain';
import { lineOfSight } from '../src/world/visibility';
import { T } from '../src/world/tiles';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): boolean {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (until && i % 10 === 0 && until()) return true;
  }
  return false;
}

/** Пустой город с больницей: медслужба включена, война и подполье стоят. */
function city(): Sim {
  const sim = makeSim(12345, { hospital: true });
  sim.ctx.hospital!.enabled = true;
  sim.war.reinforcements = false;
  sim.insurgency.paused = true;
  sim.war.command.paused = true;
  return sim;
}

/** Точка на улице в dist px от входа в больницу (не в самой больнице). */
function streetNear(sim: Sim, dist: number): { x: number; y: number } {
  const d = sim.ctx.hospital!.door!;
  for (let k = 0; k < 64; k++) {
    const a = (k / 16) * Math.PI * 2;
    const r = dist * (1 + Math.floor(k / 16) * 0.25);
    const i = sim.nav.nearestWalkable(d.x + Math.cos(a) * r, d.y + Math.sin(a) * r, 4);
    if (i < 0) continue;
    const x = sim.nav.worldX(i);
    const y = sim.nav.worldY(i);
    // Под открытым небом (улица, переулок, площадь), не в доме.
    const z = sim.map.zoneAtWorld(x, y)?.kind;
    const t = sim.map.tileAt(Math.floor(x / 16), Math.floor(y / 16));
    if (z && z !== 'hospital' && (t === T.STREET || t === T.FLOOR || t === T.PLAZA) && sim.map.levelAt(x, y) === 'city') return { x, y };
  }
  throw new Error('нет улицы у больницы');
}

const cwuMedic = (sim: Sim, at: { x: number; y: number }) =>
  spawnRole(sim.ctx, { kind: 'cwu', faction: 'cwu', profession: 'cwu_medic', division: null, rank: 0, kit: 'cwu_medic' }, at)!;

// Тесты ускоряют лечение — вернуть числа конфига.
const saved = { minStay: HOSPITAL.care.minStay, perSec: HOSPITAL.care.perSec };
afterEach(() => Object.assign(HOSPITAL.care, saved));
const fastCare = () => Object.assign(HOSPITAL.care, { minStay: 4, perSec: 30 });

describe('больница: здание', () => {
  test('в Старом городе: 16 коек с местом больного, посты у входа, места медиков, носилки', () => {
    const sim = makeSim(12345, { hospital: true });
    const H = sim.ctx.hospital!;
    expect(H.present).toBe(true);
    expect(H.beds.length).toBe(16);
    expect(H.posts.length).toBe(2);
    expect(H.hub.length).toBeGreaterThanOrEqual(4);
    expect(H.stretchers.length).toBe(3);
    const old = sim.map.poisOf('district').find((p) => p.kind === 'old')!;
    expect(H.rect!.x / 16).toBeGreaterThanOrEqual(old.x);
    expect((H.rect!.x + H.rect!.w) / 16).toBeLessThanOrEqual(old.x + old.w!);
    // Место у каждой койки — проходимое и внутри больницы.
    for (const b of H.beds) {
      expect(sim.nav.nearestWalkable(b.spot.x, b.spot.y, 1)).toBeGreaterThanOrEqual(0);
      expect(sim.map.zoneAtWorld(b.spot.x, b.spot.y)?.kind).toBe('hospital');
    }
  });
});

describe('медслужба', () => {
  test('выключена (тесты по умолчанию) — лежащий истекает кровью за DOWNED.time, как прежде', () => {
    const sim = makeSim(12345, { hospital: true });
    const at = (() => {
      sim.ctx.hospital!.enabled = true;
      const p = streetNear(sim, 200);
      sim.ctx.hospital!.enabled = false;
      return p;
    })();
    const c = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, at)!;
    sim.combat.down(c, null);
    run(sim, 25);
    expect(sim.ctx.hospital!.stats.downs).toBe(0);
    expect(c.alive).toBe(false);
  });

  test('лежащего на улице медик ТС стабилизирует, несёт на койку; вылечился — выписка', () => {
    fastCare();
    const sim = city();
    const H = sim.ctx.hospital!;
    const medic = cwuMedic(sim, streetNear(sim, 100));
    const c = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, streetNear(sim, 320))!;
    sim.combat.down(c, null);
    // Медик выехал, лежащий держится дольше DOWNED.time.
    expect(run(sim, 3, () => medic.brain instanceof EvacBrain)).toBe(true);
    expect(c.downedUntil - c.downedAt).toBeGreaterThan(20);
    expect(run(sim, 90, () => c.evacStable)).toBe(true);
    expect(medic.dragging).toBe(c);
    expect(run(sim, 120, () => c.brain instanceof PatientBrain)).toBe(true);
    expect(c.alive && c.fit).toBe(true);
    expect(H.beds.some((b) => b.occupant === c)).toBe(true);
    expect(c.asleep).toBe(true);
    // Медик вернулся к своей жизни.
    expect(medic.brain instanceof EvacBrain).toBe(false);
    expect(run(sim, 30, () => !(c.brain instanceof PatientBrain))).toBe(true);
    expect(c.health).toBeGreaterThanOrEqual(c.maxHealth * HOSPITAL.care.discharge);
    expect(c.asleep).toBe(false);
    expect(H.stats.admitted).toBe(1);
    expect(H.stats.discharged).toBe(1);
  });

  test('взять на носилки сразу не вышло (медик занят): подходит и берёт позже, стабилизация — одна', () => {
    fastCare();
    const sim = city();
    const H = sim.ctx.hospital!;
    const medic = cwuMedic(sim, streetNear(sim, 100));
    const c = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, streetNear(sim, 320))!;
    sim.combat.down(c, null);
    expect(run(sim, 60, () => medic.brain instanceof EvacBrain && (medic.brain as EvacBrain).phase === 'stabilize')).toBe(true);
    // Перевязывается ещё 2 с после конца стабилизации — носилки в этот миг не взять (CombatSystem.busy).
    medic.bandageUntil = sim.combat.now + HOSPITAL.evac.stabilize + 2;
    expect(run(sim, 20, () => medic.dragging === c)).toBe(true);
    // Раньше оставался в stabilize и каждый тик стабилизировал заново (в 15-минутном городе — тысячи раз).
    expect(H.stats.stabilized).toBe(1);
  });

  test('под огнём медик к лежащему не лезет — ждёт поодаль', () => {
    const sim = city();
    const medic = cwuMedic(sim, streetNear(sim, 80));
    const c = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, streetNear(sim, 360))!;
    // Стрелок с оружием на виду у лежащего (без мозга — просто стоит).
    const gun = createCharacter(sim.entities, sim.ctx.rng, 'rebel', c.x + 40, c.y);
    gun.brain = null;
    equipKit(gun, 'rebel_soldier', sim.ctx);
    gun.hostile = true;
    sim.combat.equip(gun, 'ak74');
    if (!lineOfSight(sim.map, gun.x, gun.y, c.x, c.y)) gun.x = c.x;
    sim.combat.down(c, null);
    expect(run(sim, 60, () => medic.brain instanceof EvacBrain && (medic.brain as EvacBrain).phase === 'wait')).toBe(true);
    expect(Math.hypot(medic.x - c.x, medic.y - c.y)).toBeGreaterThan(HOSPITAL.evac.reach + 20);
    expect(c.evacStable).toBe(false);
  });

  test('ВС на улице спасает медик ВС из больницы; должность остаётся за ним', () => {
    fastCare();
    const sim = city();
    const H = sim.ctx.hospital!;
    const hm = spawnRole(sim.ctx, { kind: 'hmedic', faction: 'cp', profession: null, division: 'su', rank: CP_UNIT.su2, kit: cpUnit(CP_UNIT.su2).kit }, H.hub[0])!;
    const u = spawnRole(sim.ctx, { kind: 'squad', faction: 'cp', profession: null, division: 'pcu', rank: CP_UNIT.pcu2, kit: cpUnit(CP_UNIT.pcu2).kit, squad: 7, lead: true }, streetNear(sim, 400))!;
    const slot = sim.staffing.slotOf(u);
    expect(slot).toBeTruthy();
    sim.combat.down(u, null);
    expect(run(sim, 5, () => hm.brain instanceof EvacBrain)).toBe(true);
    expect(run(sim, 150, () => u.brain instanceof PatientBrain)).toBe(true);
    expect(H.stats.savedCp).toBe(1);
    expect(run(sim, 30, () => u.brain instanceof CpBrain)).toBe(true);
    expect(u.alive).toBe(true);
    expect(sim.staffing.slotOf(u)).toBe(slot);
    expect(hm.brain instanceof CpBrain).toBe(true);
  });

  test('преступника на койке охраняет следователь; выписали — задержан и уведён', () => {
    fastCare();
    const sim = city();
    const H = sim.ctx.hospital!;
    cwuMedic(sim, streetNear(sim, 100));
    const lead = spawnRole(sim.ctx, { kind: 'squad', faction: 'cp', profession: null, division: 'pcu', rank: CP_UNIT.pcu2, kit: cpUnit(CP_UNIT.pcu2).kit, squad: 7, lead: true }, streetNear(sim, 500))!;
    const inv = spawnRole(sim.ctx, { kind: 'squad', faction: 'cp', profession: null, division: 'su', rank: CP_UNIT.su1, kit: cpUnit(CP_UNIT.su1).kit, squad: 7, lead: false }, { x: lead.x + 20, y: lead.y })!;
    const r = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, streetNear(sim, 300))!;
    r.hostile = true;
    sim.combat.down(r, null);
    expect(run(sim, 150, () => r.brain instanceof PatientBrain)).toBe(true);
    expect((r.brain as PatientBrain).custody).toBe(true);
    expect(run(sim, 20, () => inv.brain instanceof CustodyBrain)).toBe(true);
    expect(run(sim, 120, () => r.law.phase === 'cuffed')).toBe(true);
    expect(r.law.handler).toBe(inv);
    expect((inv.brain as CpBrain).fsm.current).toBe('escort');
    expect(H.stats.handedOver).toBe(1);
  });
});

describe('умный отход раненого ВС', () => {
  test('ранен под огнём — не бежит через улицу, а в укрытие вне линии огня; тихо — в больницу и на койку', () => {
    const sim = city();
    const H = sim.ctx.hospital!;
    const u = spawnRole(sim.ctx, { kind: 'squad', faction: 'cp', profession: null, division: 'pcu', rank: CP_UNIT.pcu2, kit: cpUnit(CP_UNIT.pcu2).kit, squad: 7, lead: true }, streetNear(sim, 600))!;
    // Враг на виду с оружием (без мозга: не стреляет — проверяем решение ВС).
    let foe: Character | null = null;
    for (let k = 0; k < 16 && !foe; k++) {
      const a = (k / 16) * Math.PI * 2;
      const i = sim.nav.nearestWalkable(u.x + Math.cos(a) * 160, u.y + Math.sin(a) * 160, 2);
      if (i < 0) continue;
      const x = sim.nav.worldX(i);
      const y = sim.nav.worldY(i);
      if (!lineOfSight(sim.map, x, y, u.x, u.y)) continue;
      foe = createCharacter(sim.entities, sim.ctx.rng, 'rebel', x, y);
    }
    expect(foe).toBeTruthy();
    foe!.brain = null;
    equipKit(foe!, 'rebel_soldier', sim.ctx);
    sim.combat.equip(foe!, 'ak74');
    foe!.hostile = true;
    run(sim, 1);
    sim.combat.damage(u, u.health - u.maxHealth * 0.25, foe, 'torso');
    const b = u.brain as CpBrain;
    expect(run(sim, 2, () => b.fsm.current === 'retreat')).toBe(true);
    expect(b.retreatPhase === 'cover' || b.retreatPhase === 'hold').toBe(true);
    // Добрался до укрытия: врагу не виден.
    expect(run(sim, 15, () => b.retreatPhase === 'hold')).toBe(true);
    expect(lineOfSight(sim.map, foe!.x, foe!.y, u.x, u.y)).toBe(false);
    // Враг ушёл — тихо: в больницу, на койку.
    sim.entities.remove(foe!);
    expect(run(sim, 240, () => u.brain instanceof PatientBrain)).toBe(true);
    expect(H.stats.walkIns).toBe(1);
  });
});
