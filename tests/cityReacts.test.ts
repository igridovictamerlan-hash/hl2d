import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnRole } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { equipKit } from '../src/systems/Population';
import { wear } from '../src/systems/Gear';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { CP_UNIT, cpUnit } from '../src/config/factions';
import { ESCALATION } from '../src/config/escalation';
import { SUSPECTS } from '../src/config/suspects';
import { lineOfSight } from '../src/world/visibility';
import type { Character } from '../src/entities/Character';
import type { Case, Look } from '../src/systems/Suspects';

/**
 * «Город реагирует» (systems/Senses.ts, Suspects.ts, Escalation.ts): свидетели убийства пугаются, бегут и прячутся;
 * донос доходит до ВС; ВС, видевший нож, сразу объявляет врага; по приметам узнают или нет; кровь — улика; страх и
 * внимание ВС копятся по кварталу и переходят в серию (код жёлтый). Сцены ставятся вручную, без толпы; всё детерминировано.
 */

type Sim = ReturnType<typeof makeSim>;
type P = { x: number; y: number };
type Scene = { c: P; killer: P; around: P[] };

/** Обычный горожанин: распорядка дня в тестах нет, дела и страх — есть. */
const CITIZEN = { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen' } as const;

/** Город без толпы: только люди теста; война и подполье не мешают. */
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

/** Прокрутить время закона вперёд (кулдаун повторной проверки), без шагов мира. */
function skip(sim: Sim, sec: number): void {
  (sim.law as unknown as { time: number }).time += sec;
}

/** Проходимые точки в кольце [rMin, rMax] вокруг p в городе; los — с прямой видимостью на p. */
function ring(sim: Sim, p: P, rMin: number, rMax: number, los = true): P[] {
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
      if (los && !lineOfSight(sim.map, q.x, q.y, p.x, p.y)) continue;
      out.push(q);
    }
  }
  return out;
}

/** Выбрать n точек из списка, не ближе gap друг к другу (порядок списка детерминирован). */
function spread(list: readonly P[], n: number, gap: number): P[] | null {
  const out: P[] = [];
  for (const q of list) {
    if (out.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= gap)) out.push(q);
    if (out.length === n) return out;
  }
  return null;
}

/**
 * Сцена на улице: центр убийства c, место убийцы (в упор к жертве) и n точек для свидетелей вокруг c — с прямой
 * видимостью на c. centers — где искать (по умолчанию — вся проходимая карта); центр не ближе gap px к avoid.
 */
function scene(sim: Sim, n: number, centers: readonly number[] = sim.nav.walkable, avoid: readonly P[] = [], gap = 0): Scene {
  for (const i of centers) {
    const c = { x: sim.nav.worldX(i), y: sim.nav.worldY(i) };
    const kind = sim.map.zoneAtWorld(c.x, c.y)?.kind;
    if (kind !== 'residential' && kind !== 'avenue' && kind !== 'plaza') continue;
    if (avoid.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < gap)) continue;
    const killer = ring(sim, c, 20, 50)[0];
    const around = spread(ring(sim, c, 90, 150), n, 40);
    if (killer && around) return { c, killer, around };
  }
  throw new Error('нет подходящей сцены');
}

/** Точка в городе в кольце [rMin, rMax] вокруг p (без требования видимости). */
function spotAround(sim: Sim, p: P, rMin: number, rMax: number): P {
  const s = ring(sim, p, rMin, rMax, false)[0];
  if (!s) throw new Error('нет точки');
  return s;
}

/** Житель в точке, лицом к face; без розыска. */
function citizen(sim: Sim, at: P, face?: P): Character {
  const c = spawnRole(sim.ctx, CITIZEN, at)!;
  c.law.wanted = false;
  c.law.hasCid = true;
  if (face) c.facing = Math.atan2(face.y - at.y, face.x - at.x);
  return c;
}

/** Патрульный ВС (PCU.03) в точке, лицом к face. */
function cop(sim: Sim, at: P, face?: P): Character {
  const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', at.x, at.y);
  equipKit(c, 'cp', sim.ctx);
  c.rank = CP_UNIT.pcu3;
  c.division = cpUnit(c.rank).group;
  c.brain = new CpBrain(c, sim.ctx);
  c.law.wanted = false;
  if (face) c.facing = Math.atan2(face.y - at.y, face.x - at.x);
  return c;
}

/** Убийство ножом: удар в торс вплотную (кровь на убийце) и добивание. */
function stab(sim: Sim, killer: Character, victim: Character): void {
  killer.inventory.add('knife', 1);
  sim.ctx.combat.equip(killer, 'knife');
  sim.ctx.combat.damage(victim, 20, killer, 'torso');
  sim.ctx.combat.damage(victim, 200, killer, 'torso');
}

/** Состояние мозга горожанина (fsm). */
const stateOf = (c: Character): string => (c.brain as CitizenBrain).fsm.current;

describe('Город реагирует', () => {
  test('нож на глазах у прохожих: страх, паника или укрытие, дело заведено', () => {
    const sim = setup();
    const s = scene(sim, 4);
    const victim = citizen(sim, s.c);
    const killer = citizen(sim, s.killer, s.c);
    const ws = s.around.map((p) => citizen(sim, p, s.c));
    stab(sim, killer, victim);
    run(sim, 1);
    // Сразу после удара кто-то испуган всерьёз (вторая ступень и выше).
    expect(ws.some((w) => sim.ctx.senses.tier(w) >= 2)).toBe(true);
    // Потом кто-то бежит или прячется.
    expect(run(sim, 3, () => ws.some((w) => ['panic', 'hide'].includes(stateOf(w))))).toBe(true);
    // Дело заведено на убийцу; свидетели увидели.
    expect(sim.ctx.suspects.cases.length).toBeGreaterThanOrEqual(1);
    expect(sim.ctx.suspects.caseOf(killer)).not.toBeNull();
    expect(sim.ctx.senses.stats.witnessed).toBeGreaterThan(0);
  });

  test('ВС видел убийство: убийца — вооружённый враг, в розыске; без ВС в поле зрения — нет', () => {
    const sim = setup();
    const s = scene(sim, 1);
    const victim = citizen(sim, s.c);
    const killer = citizen(sim, s.killer, s.c);
    cop(sim, s.around[0], s.c);
    stab(sim, killer, victim);
    run(sim, 1);
    expect(killer.hostile).toBe(true);
    expect(killer.law.wanted).toBe(true);

    // Контроль: тот же удар, ВС рядом нет — розыска нет.
    const sim2 = setup();
    const s2 = scene(sim2, 1);
    const v2 = citizen(sim2, s2.c);
    const k2 = citizen(sim2, s2.killer, s2.c);
    stab(sim2, k2, v2);
    run(sim2, 1);
    expect(k2.hostile).toBe(false);
    expect(k2.law.wanted).toBe(false);
  });

  test('донос: свидетель идёт к ВС, которого не было на месте — дело становится известным', () => {
    const sim = setup();
    const s = scene(sim, 3);
    const victim = citizen(sim, s.c);
    const killer = citizen(sim, s.killer, s.c);
    const ws = s.around.map((p) => citizen(sim, p, s.c));
    // ВС — в 300–380 px от места: за радиусом убийства (260) и не видит его.
    cop(sim, spotAround(sim, s.c, 300, 380), s.c);
    stab(sim, killer, victim);
    run(sim, 1);
    const cs = sim.ctx.suspects.caseOf(killer) as Case;
    expect(cs).toBeTruthy();
    expect(cs.known).toBe(false);
    // Свидетель успокоится (страх спадает, паника и укрытие — десятки секунд) и пойдёт к ВС: до 90 с.
    expect(run(sim, 90, () => cs.known)).toBe(true);
    // Показание дал именно свидетель (не просто донос о теле).
    expect(cs.statements.some((st) => ws.some((w) => w.pid === st.by))).toBe(true);
  });

  test('переоделся и смыл кровь — по ориентировке узнают хуже', () => {
    const sim = setup();
    const s = scene(sim, 2);
    const victim = citizen(sim, s.c);
    const killer = citizen(sim, s.killer, s.c);
    for (const p of s.around) citizen(sim, p, s.c);
    stab(sim, killer, victim);
    run(sim, 1);
    const S = sim.ctx.suspects;
    const cs = S.caseOf(killer) as Case;
    expect(cs).toBeTruthy();
    // Ориентировка с полной уверенностью — каким убийца был в момент преступления.
    cs.known = true;
    cs.desc = S.lookOf(killer) as Look;
    cs.conf = { side: 1, female: 1, torso: 1, head: 1, band: 1, weapon: 1, bloody: 1 };
    const before = S.similarity(cs.desc, cs.conf, S.lookOf(killer));
    expect(before).toBeGreaterThanOrEqual(SUSPECTS.recognize.engage);
    // Патрульный узнаёт его по ориентировке рядом.
    const p = cop(sim, spotAround(sim, s.killer, 60, 90), killer);
    expect(S.recognize(p, killer)).toBe(cs);

    // Переоделся: плащ и кепка, нож убрал, кровь смыта.
    killer.inventory.add('coat', 1);
    expect(wear(killer, 'coat')).toBeNull();
    killer.inventory.add('cap', 1);
    expect(wear(killer, 'cap')).toBeNull();
    sim.ctx.combat.equip(killer, null);
    killer.bloodyUntil = 0;
    const after = S.similarity(cs.desc, cs.conf, S.lookOf(killer));
    expect(after).toBeLessThan(SUSPECTS.recognize.engage);
    // Тот же патрульный теперь не узнаёт (прошлую проверку снимаем временем: повтор — не раньше recheck с).
    skip(sim, SUSPECTS.recognize.recheck + 1);
    expect(S.recognize(p, killer)).toBeNull();
  });

  test('улика — кровь на одежде: доказано; без крови и ножа — отпустили', () => {
    const sim = setup();
    const s = scene(sim, 1);
    const victim = citizen(sim, s.c);
    const killer = citizen(sim, s.killer, s.c);
    const innocent = citizen(sim, spotAround(sim, s.c, 420, 480));
    stab(sim, killer, victim);
    run(sim, 1);
    const S = sim.ctx.suspects;
    const cs = S.caseOf(killer) as Case;
    // ВС знает о деле (донос или свой глаз) — проверка по ориентировке.
    cs.known = true;
    expect(killer.bloodyUntil).toBeGreaterThan(sim.law.now);
    // В крови — убийство доказано (тюрьма).
    expect(S.charge(killer)).toBe('murder');
    // Посторонний — не по делу.
    expect(S.charge(innocent)).toBeNull();

    // Другой случай: убийство без ножа и без крови (кулаки, отмыл) — доказать нечем, отпускают.
    const sim2 = setup();
    const s2 = scene(sim2, 1);
    const v2 = citizen(sim2, s2.c);
    const k2 = citizen(sim2, s2.killer, s2.c);
    sim2.ctx.combat.kill(v2, k2);
    run(sim2, 1);
    const S2 = sim2.ctx.suspects;
    const cs2 = S2.caseOf(k2) as Case;
    expect(cs2).toBeTruthy();
    cs2.known = true;
    expect(k2.bloodyUntil).toBe(0);
    expect(S2.charge(k2)).toBeNull();
  });

  test('страх квартала: убийство без полиции пугает район; известные ВС убийства поднимают ступень', () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const zone = sim.map.zones.find((z) => z.kind === 'residential' && (sim.nav.anchorsByZone.get(z.id)?.length ?? 0) > 60)!;
    const anchors = sim.nav.anchorsByZone.get(zone.id)!;
    // Убийство A — без свидетелей и без полиции.
    const a = scene(sim, 1, anchors);
    const va = citizen(sim, a.c);
    const ka = citizen(sim, a.killer, a.c);
    stab(sim, ka, va);
    run(sim, 1);
    expect(E.zoneFear(zone.id)).toBeGreaterThan(ESCALATION.fear.uneasy);
    expect(E.dread(a.c.x, a.c.y)).toBeGreaterThanOrEqual(1);
    // Полиция ничего не знает — ступень прежняя.
    expect(E.tierAt(a.c.x, a.c.y)).toBe(0);
    expect(E.checkMul(a.c.x, a.c.y)).toBe(1);

    // Убийство B — на глазах у ВС: известное дело, внимание к кварталу → ступень 1 (усиленный патруль).
    const b = scene(sim, 1, anchors, [a.c], 300);
    const vb = citizen(sim, b.c);
    const kb = citizen(sim, b.killer, b.c);
    cop(sim, b.around[0], b.c);
    stab(sim, kb, vb);
    run(sim, 2);
    expect(E.tierAt(b.c.x, b.c.y)).toBe(1);
    expect(E.checkMul(b.c.x, b.c.y)).toBeGreaterThan(1);

    // Убийство C в том же квартале — второе известное: серия в квартале, ступень выше (проверки всех или комендантский час).
    const c = scene(sim, 1, anchors, [a.c, b.c], 300);
    const vc = citizen(sim, c.c);
    const kc = citizen(sim, c.killer, c.c);
    cop(sim, c.around[0], c.c);
    stab(sim, kc, vc);
    run(sim, 2);
    expect(E.tierAt(c.c.x, c.c.y)).toBeGreaterThanOrEqual(2);
    expect(E.checkMul(c.c.x, c.c.y)).toBeGreaterThanOrEqual(ESCALATION.checkMul[2]);
    expect(E.zoneFear(zone.id)).toBeGreaterThan(ESCALATION.fear.danger);
  });

  test('серия: три известных убийства в городе — код жёлтый, пока серия идёт', () => {
    const sim = setup();
    const at: P[] = [];
    // Каждое убийство — в своём квартале: два в одном квартале сами дают комендантский час (heat ≥ curfew).
    const quarters = sim.map.zones.filter((z) => z.kind === 'residential' && (sim.nav.anchorsByZone.get(z.id)?.length ?? 0) > 40);
    for (let i = 0; i < 3; i++) {
      const s = scene(sim, 1, sim.nav.anchorsByZone.get(quarters[i].id)!, at, 300);
      at.push(s.c);
      const v = citizen(sim, s.c);
      const k = citizen(sim, s.killer, s.c);
      cop(sim, s.around[0], s.c);
      stab(sim, k, v);
      run(sim, 1);
      if (i === 1) {
        // Два известных убийства — ещё не серия.
        expect(sim.ctx.escalation.holdYellow).toBe(false);
        expect(sim.ctx.war.code).toBe('green');
      }
    }
    run(sim, 2);
    expect(sim.ctx.war.code).toBe('yellow');
    expect(sim.ctx.escalation.holdYellow).toBe(true);
    expect(sim.ctx.escalation.stats.serial).toBeGreaterThan(0);
  });

  test('тело найдено: прохожий видит убитого и кричит — страх у нашедшего', () => {
    const sim = setup();
    const s = scene(sim, 1);
    const victim = citizen(sim, s.c);
    const killer = citizen(sim, s.killer, s.c);
    // Свидетелей нет — только убийца и жертва.
    stab(sim, killer, victim);
    run(sim, 0.1);
    expect(sim.combat.corpses.length).toBeGreaterThan(0);
    expect(sim.ctx.senses.stats.bodies).toBe(0);
    // Прохожий — рядом с телом, лицом к нему.
    const finder = citizen(sim, s.around[0], s.c);
    expect(run(sim, 5, () => sim.ctx.senses.stats.bodies > 0)).toBe(true);
    expect(sim.combat.corpses.some((k) => k.found)).toBe(true);
    expect(sim.ctx.senses.fearOf(finder)).toBeGreaterThan(0);
  });
});
