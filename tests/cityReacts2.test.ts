import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnRole } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { equipKit } from '../src/systems/Population';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { Mover } from '../src/ai/Mover';
import type { Brain } from '../src/ai/Brain';
import { CP_UNIT, cpUnit } from '../src/config/factions';
import { ESCALATION } from '../src/config/escalation';
import { MEMORIALS } from '../src/config/memorials';
import { ZONE_NAMES } from '../src/config/names';
import { BOND } from '../src/systems/Relations';
import { lineOfSight } from '../src/world/visibility';
import type { Character } from '../src/entities/Character';
import type { Case } from '../src/systems/Suspects';

/**
 * «Город реагирует 2.0» (systems/Escalation.ts, Suspects.ts, Memorials.ts): комендантский час в жилом квартале
 * выгоняет людей с улицы без паники и застываний; проспект не уходит в комендантский час; окрик идёт раньше штрафа;
 * после известного убийства ВС обходит дома рядом; у места гибели появляется памятное место, куда приходит родня.
 * Сцены ставятся вручную (как в cityReacts.test.ts и curfew.test.ts); всё детерминировано — фиксированный сид.
 */

type Sim = ReturnType<typeof makeSim>;
type P = { x: number; y: number };
/** Внутренний вызов Escalation, которым тест поднимает внимание ВС к кварталу (как в curfew.test.ts). */
type Hidden = { addHeat(z: number, v: number): void };

/** Обычный горожанин: распорядка дня в тестах нет, дела и страх — есть. */
const CITIZEN = { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen' } as const;
/** Вор: закрытый рот — свидетель, который видел убийство и молчит (Suspects.closedMouth). */
const THIEF = { kind: 'citizen', faction: 'citizen', profession: 'thief', division: null, rank: 0, kit: 'thief' } as const;

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

function heat(sim: Sim, zone: number, v: number): void {
  (sim.ctx.escalation as unknown as Hidden).addHeat(zone, v);
}

/** Точка под открытым небом (не в помещении, не в подъезде и не во дворе): как War.outdoors для человека. */
const outdoors = (sim: Sim, q: P): boolean => sim.ctx.war.outdoors({ x: q.x, y: q.y } as Character);

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

/** Выбрать n точек из списка, не ближе gap px друг к другу (порядок списка детерминирован). */
function spread(list: readonly P[], n: number, gap: number): P[] {
  const out: P[] = [];
  for (const q of list) {
    if (out.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= gap)) out.push(q);
    if (out.length === n) break;
  }
  return out;
}

/** Первая точка из списка, не ближе gap px ко всем занятым (taken). */
function apart(list: readonly P[], taken: readonly P[], gap: number): P {
  const q = list.find((p) => taken.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= gap));
  if (!q) throw new Error('нет свободной точки');
  return q;
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

/** Постовой ВС, смотрящий на face (как в curfew.test.ts). */
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

/**
 * Житель, который стоит на месте и ничего не решает: застывший на улице (мозг не двигает его, в дом не уходит).
 * Нужен, чтобы проверить окрик и штраф для того, кто не идёт домой.
 */
function still(): Brain {
  return { mover: new Mover(1), stateName: 'стоит на месте', update() {} };
}

/** Убийство ножом: удар в торс вплотную (кровь на убийце) и добивание. */
function stab(sim: Sim, killer: Character, victim: Character): void {
  killer.inventory.add('knife', 1);
  sim.ctx.combat.equip(killer, 'knife');
  sim.ctx.combat.damage(victim, 20, killer, 'torso');
  sim.ctx.combat.damage(victim, 200, killer, 'torso');
}

/** Крупные жилые зоны (больше 300 якорей), по порядку карты. */
function bigResidential(sim: Sim): { id: number; anchors: number[] }[] {
  return sim.map.zones
    .filter((z) => z.kind === 'residential' && (sim.nav.anchorsByZone.get(z.id)?.length ?? 0) > 300)
    .map((z) => ({ id: z.id, anchors: sim.nav.anchorsByZone.get(z.id)! }));
}

/** Жилой квартал (крупная зона) и точка на улице в нём, с точкой для постового с видимостью на неё. */
function quarter(sim: Sim): { zone: number; at: P; cop: P } {
  for (const z of bigResidential(sim)) {
    for (const a of z.anchors) {
      const at = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
      if (!outdoors(sim, at)) continue;
      const stand = ring(sim, at, 60, 110).filter((q) => sim.map.zoneAtWorld(q.x, q.y)?.id === z.id);
      if (stand.length) return { zone: z.id, at, cop: stand[0] };
    }
  }
  throw new Error('нет подходящего квартала');
}

/** Точка на улице зоны и точка для патрульного в прямой видимости от неё (60–110 px). */
function watchPair(sim: Sim, zid: number): { at: P; cop: P } {
  for (const a of sim.nav.anchorsByZone.get(zid) ?? []) {
    const at = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
    if (!outdoors(sim, at)) continue;
    const stand = ring(sim, at, 60, 110).filter((q) => sim.map.zoneAtWorld(q.x, q.y)?.id === zid);
    if (stand.length) return { at, cop: stand[0] };
  }
  throw new Error('нет места для наблюдения');
}

/** Место убийства в жилом квартале с открытым обзором: вокруг есть места для трёх свидетелей и вора (≥ 4 точек). */
function crimeSpot(sim: Sim): { c: P; seen: P[] } {
  for (const z of bigResidential(sim)) {
    for (const a of z.anchors) {
      const c = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
      if (!outdoors(sim, c)) continue;
      const seen = ring(sim, c, 60, 230);
      if (spread(seen, 4, 30).length >= 4) return { c, seen };
    }
  }
  throw new Error('нет места для убийства');
}

/** Сколько раз житель (по номеру CID) получил запись в журнале за комендантский час в квартале: штраф или арест. */
function zoneLog(sim: Sim, cid: string, verb: 'оштрафовал' | 'задержал'): number {
  return sim.log.filter((l) => l.includes(`#${cid} `) && l.includes('комендантский час в квартале') && l.includes(verb)).length;
}

describe('Город реагирует 2.0', () => {
  test('комендантский час в квартале: жители уходят с улицы, никто не замирает', { timeout: 60_000 }, () => {
    CitizenBrain.unfreezes = 0;
    const sim = setup();
    const H = sim.ctx.housing;
    // Жилая зона с наибольшим числом домов.
    const counts = new Map<number, number>();
    for (const d of H.dwellings) {
      const z = sim.map.zoneAtWorld(d.at.x, d.at.y);
      if (z?.kind === 'residential') counts.set(z.id, (counts.get(z.id) ?? 0) + 1);
    }
    const zid = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    // Жители квартала: по одному в доме (до 14), на улице рядом с дверью — выходят из дома на улицу.
    const homes = H.dwellings.filter((d) => sim.map.zoneAtWorld(d.at.x, d.at.y)?.id === zid && !d.reserved).slice(0, 14);
    const taken: P[] = [];
    for (const d of homes) {
      const list = (sim.nav.anchorsByZone.get(zid) ?? [])
        .map((a) => ({ x: sim.nav.worldX(a), y: sim.nav.worldY(a) }))
        .filter((q) => outdoors(sim, q) && Math.hypot(q.x - d.at.x, q.y - d.at.y) >= 40 && Math.hypot(q.x - d.at.x, q.y - d.at.y) <= 200)
        .filter((q) => taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= 40))
        .sort((a, b) => Math.hypot(a.x - d.at.x, a.y - d.at.y) - Math.hypot(b.x - d.at.x, b.y - d.at.y));
      if (!list.length) continue;
      taken.push(list[0]);
      H.settle([citizen(sim, list[0])], d);
    }
    // Остальные горожане — по всему городу (всего около сорока); дом у каждого — свой.
    for (let k = 0; k < 400 && sim.entities.list.filter((c) => c.faction === 'citizen').length < 40; k++) {
      const a = sim.ctx.rng.pick(sim.nav.walkable);
      const at = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
      if (!sim.ctx.war.inCity(at.x, at.y)) continue;
      H.house(citizen(sim, at));
    }
    // Упрямец: один житель стоит на улице и домой не идёт (мозг его не ведёт) — на нём проверяем окрик и штраф.
    // Он в прямой видимости постового ВС (60–110 px), — тот его и заметит.
    const pair = watchPair(sim, zid);
    const residents = () => sim.entities.list.filter((c) => c.faction === 'citizen' && c.alive && c.home >= 0 && sim.map.zoneAtWorld(H.dwellings[c.home].at.x, H.dwellings[c.home].at.y)?.id === zid);
    const outdoorsOf = (list: Character[]) => list.filter((c) => sim.ctx.war.outdoors(c)).length;
    const res = residents();
    const stubborn = res[0];
    stubborn.x = pair.at.x;
    stubborn.y = pair.at.y;
    stubborn.brain = still();
    // ВС в квартале: постовой смотрит на упрямца (стоит на месте), патрульный ходит по улицам — им есть кого окликнуть.
    const streetPts = (sim.nav.anchorsByZone.get(zid) ?? []).map((a) => ({ x: sim.nav.worldX(a), y: sim.nav.worldY(a) })).filter((q) => outdoors(sim, q));
    postCop(sim, pair.cop, pair.at);
    for (const p of spread(streetPts.filter((q) => Math.hypot(q.x - pair.at.x, q.y - pair.at.y) > 300), 1, 0)) cop(sim, p);
    // Остальные — уходят домой; их считаем.
    const walkers = res.slice(1);
    const start = outdoorsOf(walkers);
    expect(walkers.length).toBeGreaterThanOrEqual(7);
    expect(start).toBeGreaterThanOrEqual(6);

    heat(sim, zid, 200);
    run(sim, 1);
    expect(sim.ctx.escalation.tier[zid]).toBe(3);

    // 120 с: сидеть дома, не прятаться на улице; застывших на улице мозг будит (счётчик unfreezes).
    const hideRun = new Map<number, number>();
    let hideMax = 0;
    for (let t = 1; t <= 120 * 60; t++) {
      sim.step();
      if (t % 60) continue;
      for (const c of sim.entities.list) {
        if (!c.alive || !(c.brain instanceof CitizenBrain)) continue;
        const hiding = c.brain.fsm.current === 'hide' && sim.ctx.war.outdoors(c);
        const n = hiding ? (hideRun.get(c.pid) ?? 0) + 1 : 0;
        hideRun.set(c.pid, n);
        hideMax = Math.max(hideMax, n);
      }
    }
    const end = outdoorsOf(walkers);
    expect(end, `жители квартала на улице: было ${start}, стало ${end}`).toBeLessThanOrEqual(Math.max(1, start * 0.2));
    // Идущих домой не останавливают (нарушения нет — они в укрытии).
    expect(walkers.filter((c) => zoneLog(sim, c.cid, 'оштрафовал') + zoneLog(sim, c.cid, 'задержал') > 0)).toHaveLength(0);
    // Упрямца окликнули; штраф — после отсрочки и паузы между проверками CID. Ждём его (ещё до 150 с).
    expect(sim.ctx.escalation.stats.warns).toBeGreaterThanOrEqual(1);
    expect(run(sim, 150, () => zoneLog(sim, stubborn.cid, 'оштрафовал') > 0)).toBe(true);
    // Никого не оштрафовали за час в квартале больше одного раза (повторно — арест, LAW.zoneCurfewRepeat).
    const fines = Math.max(0, ...sim.entities.list.filter((c) => c.faction === 'citizen').map((c) => zoneLog(sim, c.cid, 'оштрафовал')));
    expect(fines).toBeLessThanOrEqual(1);
    expect(CitizenBrain.unfreezes).toBeLessThan(5);
    expect(hideMax).toBeLessThanOrEqual(10);
  });

  test('на проспекте комендантского часа не бывает: много известных убийств — ступень не выше 2', { timeout: 60_000 }, () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const av = sim.map.zones.find((z) => z.kind === 'avenue' && z.name === ZONE_NAMES.avenue[0])!;
    const pts = (sim.nav.anchorsByZone.get(av.id) ?? []).map((a) => ({ x: sim.nav.worldX(a), y: sim.nav.worldY(a) }));
    const centers = spread(pts, 4, 300);
    expect(centers.length).toBeGreaterThanOrEqual(3);
    // Каждое убийство на глазах у патрульного ВС: дело известно сразу (cpSaw).
    for (const c of centers) {
      const killers = ring(sim, c, 20, 50);
      const watch = ring(sim, c, 90, 150);
      if (!killers.length || !watch.length) continue;
      const victim = citizen(sim, c);
      const killer = citizen(sim, killers[0], c);
      cop(sim, watch[0], c);
      stab(sim, killer, victim);
      run(sim, 2);
    }
    run(sim, 3);
    const known = sim.ctx.suspects.cases.filter((cs) => cs.zone === av.id && cs.known && cs.kind === 'murder');
    expect(known.length).toBeGreaterThanOrEqual(3);
    // Серия по городу есть (ступень 3 по городу), но проспект — не зона часа.
    expect(E.serial).toBe(true);
    expect(E.tier[av.id]).toBe(2);
    const p = centers[0];
    expect(E.tierAt(p.x, p.y)).toBeLessThanOrEqual(2);
    expect(E.curfewAt(p.x, p.y)).toBe(false);
  });

  test('сначала предупреждение: окрик, штраф — не раньше ESCALATION.warn.grace', { timeout: 60_000 }, () => {
    const sim = setup();
    const E = sim.ctx.escalation;
    const W = ESCALATION.warn;
    const q = quarter(sim);
    postCop(sim, q.cop, q.at);
    // Застывший на улице житель: мозг не ведёт его домой (в укрытие не уходит), сам он стоит.
    const c = citizen(sim, q.at);
    c.brain = still();
    heat(sim, q.zone, 200);
    run(sim, 2);
    expect(E.tier[q.zone]).toBe(3);
    // Сперва — окрик (после отсрочки на дорогу домой).
    let tWarn = -1;
    expect(run(sim, 120, () => {
      if (E.stats.warns > 0) tWarn = sim.law.now;
      return E.stats.warns > 0;
    })).toBe(true);
    expect(E.stats.warns).toBeGreaterThanOrEqual(1);
    // Штраф — не раньше чем через grace после окрика. Окно побольше: между проверками CID есть перерыв (recheck).
    let tFine = -1;
    expect(run(sim, 240, () => {
      if (zoneLog(sim, c.cid, 'оштрафовал') > 0) tFine = sim.law.now;
      return zoneLog(sim, c.cid, 'оштрафовал') > 0;
    })).toBe(true);
    expect(tFine - tWarn).toBeGreaterThanOrEqual(W.grace);
  });

  test('поквартирный обход: после известного убийства ВС стучит в дома рядом, в том числе к молчащему свидетелю', { timeout: 120_000 }, () => {
    const sim = setup();
    const S = sim.ctx.suspects;
    const H = sim.ctx.housing;
    const { c, seen } = crimeSpot(sim);
    const victim = citizen(sim, c);
    const killerAt = ring(sim, c, 20, 50)[0];
    const killer = citizen(sim, killerAt, c);
    // Свидетели: трое видят убийство издалека и идут донести; вор — видит и молчит (закрытый рот).
    const wp = spread(seen, 3, 30);
    const witnesses = wp.map((p) => citizen(sim, p, c));
    const thief = spawnRole(sim.ctx, THIEF, apart(seen, wp, 30))!;
    thief.law.hasCid = true;
    thief.facing = Math.atan2(c.y - thief.y, c.x - thief.x);
    // ВС вне радиуса убийства (260 px) — видеть не может, донос пойдёт к нему (как в cityReacts.test.ts).
    cop(sim, spotAround(sim, c, 300, 380), c);
    // Ещё два свободных патрульных поблизости — обход берёт кто-то из них.
    for (const p of spread(ring(sim, c, 420, 520, false), 2, 80)) cop(sim, p);
    stab(sim, killer, victim);
    // Нож убийца бросил: с ножом в руке его взяли бы на месте (кровь остаётся уликой).
    sim.ctx.combat.equip(killer, null);
    run(sim, 1);
    const cs = S.caseOf(killer) as Case;
    expect(cs).toBeTruthy();
    expect(cs.witnesses.has(thief.pid)).toBe(true);
    // Молчащий свидетель видел убийство; дальше стоит дома (мозг его не ведёт) — переставим, когда обход назначат.
    thief.brain = still();
    expect(run(sim, 90, () => cs.known)).toBe(true);
    expect(witnesses.some((w) => cs.witnesses.has(w.pid))).toBe(true);
    expect(run(sim, 30, () => S.canvasses.length > 0)).toBe(true);
    const cv = S.canvasses[0];
    const d = cv.doors[0].d;
    const ts = sim.map.tileSize;
    thief.x = (d.room.x + d.room.w / 2) * ts;
    thief.y = (d.room.y + d.room.h / 2) * ts;
    expect(H.inside(d, thief)).toBe(true);
    // Обход: стук в первую дверь — не позже 90 с (от известности дела).
    expect(run(sim, 90, () => S.stats.knocks >= 1)).toBe(true);
    expect(S.stats.canvass).toBeGreaterThanOrEqual(1);
    // Опрос у первой двери (дом вора) закончился: обход пошёл к следующей двери (cv.i растёт после ответа жильцов).
    // Рассказал ли вор (hardTalk — редко) — S.stats.canvassTold, не проверяем: это шанс.
    expect(run(sim, 15, () => cv.i >= 1)).toBe(true);
  });

  test('мемориал и родня: после гибели мирного — памятное место, родня приходит, чужие — нет', { timeout: 120_000 }, () => {
    const sim = setup();
    const M = sim.ctx.memorials;
    const q = quarter(sim);
    const victim = citizen(sim, q.at);
    const killer = citizen(sim, ring(sim, q.at, 20, 50)[0], q.at);
    const around = spread(ring(sim, q.at, 150, 250), 2, 60);
    // Родня и чужой стоят рядом (мозг не двигает их: посещение — в пределах visit.seek от места).
    const kin = citizen(sim, around[0]);
    kin.brain = still();
    const stranger = citizen(sim, around[1]);
    sim.ctx.relations.link(kin, victim, 80, 80, BOND.KIN);
    stab(sim, killer, victim);
    // До срока (MEMORIALS.delay) — ничего.
    run(sim, MEMORIALS.delay - 20);
    expect(M.list.length).toBe(0);
    // Тело убрали (санитар; пока оно лежит, место не ставят — CrimeScenes держит его открытым). После срока — место у стены.
    sim.ctx.combat.corpses.splice(0, sim.ctx.combat.corpses.length);
    expect(run(sim, 60, () => M.list.length > 0)).toBe(true);
    const m = M.list[0];
    expect(m.pid).toBe(victim.pid);
    expect(M.stats.placed).toBeGreaterThanOrEqual(1);
    // Родня находит это место; чужой — нет.
    expect(M.forVisitor(kin)).toBe(m);
    expect(M.forVisitor(stranger)).toBeNull();
    // Есть где встать у места — своя сторона.
    expect(M.spot(m, kin)).not.toBeNull();
    // Приход: цветы или свеча; тот же человек сразу не придёт снова (не чаще visit.every с).
    const before = m.flowers + m.candles;
    const visits = m.visits;
    M.visit(kin, m);
    expect(m.flowers + m.candles).toBe(before + 1);
    expect(m.visits).toBe(visits + 1);
    expect(M.forVisitor(kin)).toBeNull();
  });
});
