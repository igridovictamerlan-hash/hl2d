import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnRole } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { equipKit } from '../src/systems/Population';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { CP_UNIT, cpUnit } from '../src/config/factions';
import { ESCALATION } from '../src/config/escalation';
import { LAW } from '../src/config/law';
import { lineOfSight } from '../src/world/visibility';
import type { Character } from '../src/entities/Character';

/**
 * Комендантский час в квартале (systems/Escalation.ts): только в жилых и промышленных зонах; отсрочка на дорогу домой;
 * ВС сперва окликает, штрафует упрямых, повторно — арест; идущего домой не трогают; на ступени 2+ у выходов из квартала
 * стоят патрульные. Сцены ставятся вручную, без толпы.
 */

type Sim = ReturnType<typeof makeSim>;
type P = { x: number; y: number };
type Hidden = { addHeat(z: number, v: number): void; heat: Float32Array; heatAt: Float32Array };

function setup(seed = 12345): Sim {
  const sim = makeSim(seed);
  sim.war.reinforcements = false;
  sim.insurgency.paused = true;
  sim.war.command.paused = true;
  return sim;
}

function run(sim: Sim, sec: number, until?: () => boolean): boolean {
  for (let t = 0; t < sec * 60; t++) {
    sim.step();
    if (until?.()) return true;
  }
  return false;
}

/** Прокрутить время закона вперёд, без шагов мира. */
function skip(sim: Sim, sec: number): void {
  (sim.law as unknown as { time: number }).time += sec;
}

/** Внимание ВС к кварталу (как после известных преступлений). */
function heat(sim: Sim, zone: number, v: number): void {
  (sim.ctx.escalation as unknown as Hidden).addHeat(zone, v);
}

/** Проходимые точки в кольце [rMin, rMax] вокруг p в городе, с прямой видимостью на p. */
function ring(sim: Sim, p: P, rMin: number, rMax: number): P[] {
  const ts = sim.nav.ts;
  const R = Math.ceil(rMax / ts) + 1;
  const ax0 = Math.round(p.x / ts) - 1;
  const ay0 = Math.round(p.y / ts) - 1;
  const out: P[] = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const ax = ax0 + dx;
      const ay = ay0 + dy;
      if (!sim.nav.isWalkable(ax, ay)) continue;
      const q = { x: (ax + 1) * ts, y: (ay + 1) * ts };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < rMin || d > rMax || !sim.ctx.war.inCity(q.x, q.y)) continue;
      if (!lineOfSight(sim.map, q.x, q.y, p.x, p.y)) continue;
      out.push(q);
    }
  }
  return out;
}

/** Крупный жилой квартал и точка в нём на улице (не в доме), у которой есть точка для постового с видимостью. */
function quarter(sim: Sim): { zone: number; at: P; cop: P } {
  const zones = sim.map.zones.filter((z) => z.kind === 'residential' && (sim.nav.anchorsByZone.get(z.id)?.length ?? 0) > 300);
  for (const z of zones) {
    for (const a of sim.nav.anchorsByZone.get(z.id)!) {
      const at = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
      const stand = ring(sim, at, 60, 110).filter((q) => sim.map.zoneAtWorld(q.x, q.y)?.id === z.id);
      if (stand.length && sim.ctx.war.outdoors({ x: at.x, y: at.y } as Character)) return { zone: z.id, at, cop: stand[0] };
    }
  }
  throw new Error('нет подходящего квартала');
}

/** Постовой ВС, смотрящий на target. */
function postCop(sim: Sim, at: P, face: P): Character {
  const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', at.x, at.y);
  equipKit(c, 'cp', sim.ctx);
  c.rank = CP_UNIT.pcu3;
  c.division = cpUnit(c.rank).group;
  const facing = Math.atan2(face.y - at.y, face.x - at.x);
  c.brain = new CpBrain(c, sim.ctx, { post: at, facing, duty: 'post' });
  c.facing = facing;
  c.law.wanted = false;
  return c;
}

/** Патрульный ВС без поста (свободен для поста на выходе). */
function patrolCop(sim: Sim, at: P): Character {
  const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', at.x, at.y);
  equipKit(c, 'cp', sim.ctx);
  c.rank = CP_UNIT.pcu3;
  c.division = cpUnit(c.rank).group;
  c.brain = new CpBrain(c, sim.ctx);
  c.law.wanted = false;
  return c;
}

describe('Комендантский час в квартале', () => {
  test('только в жилых и промышленных зонах: проспект, площадь и лавки — не выше проверок', () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const kinds = new Set<string>(ESCALATION.curfewKinds);
    const probe = (kind: string) => sim.map.zones.find((z) => z.kind === kind);
    for (const kind of ['avenue', 'plaza', 'shop']) {
      const z = probe(kind);
      if (!z) continue;
      heat(sim, z.id, 200);
    }
    const q = quarter(sim);
    heat(sim, q.zone, 200);
    run(sim, 1.5);
    for (const z of sim.map.zones) {
      if (E.tier[z.id] === 3) expect(kinds.has(z.kind)).toBe(true);
    }
    for (const kind of ['avenue', 'plaza', 'shop']) {
      const z = probe(kind);
      if (z) expect(E.tier[z.id]).toBe(2);
    }
    expect(E.tier[q.zone]).toBe(3);
    expect(E.curfewOn).toBe(true);
  });

  test('отсрочка: до curfewGrace никто не нарушитель; идущий домой не нарушает никогда', () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const q = quarter(sim);
    const walker = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen' }, q.at)!;
    walker.law.wanted = false;
    walker.law.hasCid = true;
    const cop = postCop(sim, q.cop, q.at);
    heat(sim, q.zone, 200);
    run(sim, 2);
    expect(E.tier[q.zone]).toBe(3);
    // Отсрочка идёт: ни окрика, ни нарушения.
    expect(E.curfewAt(q.at.x, q.at.y)).toBe(false);
    expect(E.curfewViolation(walker)).toBe(false);
    expect(E.stats.warns).toBe(0);
    // Житель сам идёт домой («укрыться») — окриков и штрафов нет и после отсрочки.
    run(sim, 3);
    expect((walker.brain as CitizenBrain).fsm.current).toBe('shelter');
    skip(sim, ESCALATION.curfewGrace + 5);
    run(sim, 30);
    expect(E.curfewAt(q.at.x, q.at.y)).toBe(true);
    expect(E.warn(cop, walker)).toBe(false);
    skip(sim, ESCALATION.warn.grace + 10);
    expect(E.curfewViolation(walker)).toBe(false);
    expect(sim.log.some((l) => l.includes('комендантский час в квартале'))).toBe(false);
  });

  test('окрик → штраф → повторно арест: упрямого предупреждают, потом штрафуют, потом задерживают', { timeout: 60_000 }, () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const W = ESCALATION.warn;
    const q = quarter(sim);
    // Нарушитель без мозга (как игрок): стоит на улице и не идёт домой.
    const p = createCharacter(sim.entities, sim.ctx.rng, 'citizen', q.at.x, q.at.y, true);
    p.law.wanted = false;
    p.law.hasCid = true;
    p.money = 100;
    const cop = postCop(sim, q.cop, q.at);
    heat(sim, q.zone, 200);
    run(sim, 2);
    expect(E.tier[q.zone]).toBe(3);
    // Отсрочка — тишина.
    run(sim, 10);
    expect(E.stats.warns).toBe(0);
    expect(p.law.phase).toBe('none');
    skip(sim, ESCALATION.curfewGrace);
    // После отсрочки — окрик (не приказ): игрок не остановлен, в журнале строка.
    expect(run(sim, 20, () => E.stats.warns > 0)).toBe(true);
    expect(p.law.phase).toBe('none');
    expect(sim.log.some((l) => l === W.playerLog)).toBe(true);
    expect(cop.speech?.text).toBeTruthy();
    expect(E.curfewViolation(p)).toBe(false);
    // Слишком рано для штрафа: окрик был только что.
    run(sim, W.grace / 2);
    expect(sim.log.some((l) => l.includes('оштрафовал'))).toBe(false);
    // После grace — приказ и штраф «по домам».
    skip(sim, W.grace / 2 + 5);
    expect(run(sim, 40, () => sim.log.some((l) => l.includes('оштрафовал')))).toBe(true);
    expect(p.money).toBeLessThan(100);
    expect(sim.log.some((l) => l.includes('оштрафовал') && l.includes('комендантский час в квартале'))).toBe(true);
    // Вскоре после проверки — не останавливают снова.
    const finedAt = sim.law.now;
    run(sim, 5);
    expect(p.law.phase).toBe('none');
    expect(E.curfewViolation(p)).toBe(false);
    expect(sim.law.now - p.law.lastCheck).toBeLessThan(W.recheck);
    // Не ушёл — после recheck повторное нарушение в пределах LAW.zoneCurfewRepeat: арест.
    skip(sim, W.recheck);
    expect(sim.law.now - finedAt).toBeLessThan(LAW.zoneCurfewRepeat);
    expect(run(sim, 40, () => sim.log.some((l) => l.includes('задержал') && l.includes('комендантский час в квартале')))).toBe(true);
  });

  test('LawSystem: повторный штраф за час в квартале в пределах zoneCurfewRepeat — арест, позже — снова штраф', () => {
    const sim = setup();
    const q = quarter(sim);
    const cop = postCop(sim, q.cop, q.at);
    const t = createCharacter(sim.entities, sim.ctx.rng, 'citizen', q.at.x, q.at.y, true);
    t.law.wanted = false;
    t.law.hasCid = true;
    t.money = 200;
    t.law.reason = 'zone_curfew';
    const v1 = sim.law.judge(t);
    expect(v1.kind).toBe('fine');
    expect(v1.fine).toBe(LAW.fines.zone_curfew);
    sim.law.apply(cop, t, v1);
    t.law.reason = 'zone_curfew';
    expect(sim.law.judge(t).kind).toBe('arrest');
    skip(sim, LAW.zoneCurfewRepeat + 1);
    t.law.reason = 'zone_curfew';
    expect(sim.law.judge(t).kind).toBe('fine');
  });
});

describe('Посты на выходах из квартала', () => {
  test('ступень 2: двое патрульных встают у выходов лицом наружу, ступень упала — расходятся', { timeout: 60_000 }, () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const q = quarter(sim);
    // Часть патрульных уйдёт по рации «прочесать квартал» (вызов), остальные свободны — их и ставят на выходы.
    const around = ring(sim, q.at, 40, 220);
    const cops = Array.from({ length: 8 }, (_, i) => patrolCop(sim, around[(i * 7) % around.length]));
    heat(sim, q.zone, ESCALATION.tiers.lockdown + 4);
    run(sim, ESCALATION.posts.every + 2);
    expect(E.tier[q.zone]).toBe(2);
    const posted = cops.filter((c) => (c.brain as CpBrain).rally);
    expect(posted).toHaveLength(ESCALATION.posts.count[2]);
    expect(E.stats.posts).toBe(posted.length);
    const spots = posted.map((c) => (c.brain as CpBrain).rally!);
    // Места в этом квартале, не ближе spacing друг к другу.
    for (const s of spots) expect(sim.map.zoneAtWorld(s.x, s.y)?.id).toBe(q.zone);
    expect(Math.hypot(spots[0].x - spots[1].x, spots[0].y - spots[1].y)).toBeGreaterThanOrEqual(ESCALATION.posts.spacing);
    // Приходят на место и стоят (состояние guard); остальные патрулируют.
    expect(run(sim, 60, () => posted.every((c) => Math.hypot(c.x - (c.brain as CpBrain).rally!.x, c.y - (c.brain as CpBrain).rally!.y) < LAW.postArrive + 6))).toBe(true);
    for (const c of posted) expect((c.brain as CpBrain).fsm.current).toBe('guard');
    expect(cops.filter((c) => !(c.brain as CpBrain).rally).length).toBeGreaterThan(0);
    // Ступень упала — посты сняты, юниты вернулись к патрулю.
    const h = E as unknown as Hidden;
    h.heat[q.zone] = 0;
    run(sim, ESCALATION.posts.every + 3);
    expect(E.tier[q.zone]).toBe(0);
    for (const c of posted) {
      expect((c.brain as CpBrain).rally).toBeNull();
      expect((c.brain as CpBrain).fsm.current).not.toBe('guard');
    }
  });

  test('пост на выходе проверяет проходящих с множителем ступени квартала', { timeout: 60_000 }, () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const q = quarter(sim);
    const around = ring(sim, q.at, 40, 220);
    for (let i = 0; i < 8; i++) patrolCop(sim, around[(i * 7) % around.length]);
    heat(sim, q.zone, ESCALATION.tiers.lockdown + 4);
    run(sim, ESCALATION.posts.every + 2);
    const cop = sim.entities.list.find((c) => c.brain instanceof CpBrain && (c.brain as CpBrain).rally)!;
    expect(cop).toBeTruthy();
    const b = cop.brain as CpBrain;
    expect(run(sim, 60, () => Math.hypot(cop.x - b.rally!.x, cop.y - b.rally!.y) < LAW.postArrive + 6)).toBe(true);
    // Прохожий рядом с постом, документы в порядке: ВС обязательно его остановит (ступень 2 — checkMul × 4.5).
    const pass = createCharacter(sim.entities, sim.ctx.rng, 'citizen', b.rally!.x + Math.cos(b.rallyFacing) * 70, b.rally!.y + Math.sin(b.rallyFacing) * 70, true);
    pass.law.wanted = false;
    pass.law.hasCid = true;
    pass.law.lastCheck = -1e9;
    expect(E.checkMul(b.rally!.x, b.rally!.y)).toBeGreaterThan(1);
    expect(run(sim, 40, () => pass.law.phase !== 'none' || pass.law.lastCheck > 0)).toBe(true);
  });
});
