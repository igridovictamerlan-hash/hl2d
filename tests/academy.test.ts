import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { generateCity } from '../src/world/generator/CityGenerator';
import { ACADEMY } from '../src/config/academy';
import { STAFFING } from '../src/config/staffing';
import { ACCESS } from '../src/config/access';
import { AStar } from '../src/ai/AStar';
import { CP_UNIT, cpUnit } from '../src/config/factions';
import { CadetBrain } from '../src/ai/brains/CadetBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { EnlistBrain } from '../src/ai/brains/EnlistBrain';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;
const run = (sim: Sim, sec: number, until?: () => boolean) => {
  for (let t = 0; t < sec * 60; t++) {
    sim.step();
    if (until?.()) return;
  }
};

/** Зачислить n граждан курсантами (сразу в кубрике). */
function cadets(sim: Sim, n: number): Character[] {
  const A = sim.academy;
  const pool = sim.entities.list.filter((c) => c.faction === 'citizen' && !c.isPlayer && c.profession === 'citizen' && c.brain instanceof CitizenBrain).slice(0, n);
  for (const c of pool) {
    const b = A.beds[0];
    c.x = c.prevX = b.x;
    c.y = c.prevY = b.y;
    expect(A.enroll(c)).toBe(true);
  }
  return pool;
}

describe('академия ВС: здание', () => {
  test('на картах есть академия: вахта с турникетом, плац, тир, класс, кубрик, столовая, кабинет', () => {
    for (const seed of [12345, 777, 2024]) {
      const map = generateCity(seed);
      const a = map.poisOf('academy')[0];
      expect(a).toBeTruthy();
      expect(map.zoneByKind('academy')).toBeTruthy();
      for (const t of ['academy_range', 'academy_plac', 'academy_class', 'academy_barracks', 'academy_mess', 'academy_office', 'academy_vakhta', 'academy_lobby'] as const) {
        expect(map.poisOf(t).length, t).toBe(1);
      }
      expect(map.poisOf('academy_target').length).toBe(3);
      expect(map.poisOf('academy_lane').length).toBe(3);
      expect(map.poisOf('academy_post').length).toBe(2);
      expect(map.poisOf('academy_bunk').length).toBeGreaterThanOrEqual(7);
    }
  });

  test('места занятий рассчитаны: строй, полосы тира, парты, койки, вахта', () => {
    const sim = makeSim(12345);
    const A = sim.academy;
    expect(A.present).toBe(true);
    expect(A.lanes.length).toBe(3);
    expect(A.waitSpots.length).toBeGreaterThan(4);
    expect(A.ranks.length).toBe(ACADEMY.recruit.capacity);
    expect(A.drillLoop.length).toBe(4);
    expect(A.ptLoop.length).toBe(4);
    expect(A.seats.length).toBeGreaterThanOrEqual(8);
    expect(A.beds.length).toBeGreaterThanOrEqual(ACADEMY.recruit.capacity);
    expect(A.posts.length).toBe(2);
    expect(A.applySpot).toBeTruthy();
    // Всё это — в здании академии.
    for (const p of [...A.ranks, ...A.seats, ...A.beds, ...A.lanes.map((l) => l.spot), ...A.posts]) expect(A.inside(p.x, p.y)).toBe(true);
    // Каждая полоса тира — к своей мишени.
    expect(new Set(A.lanes.map((l) => l.target)).size).toBe(3);
  });
});

describe('академия ВС: учёба', () => {
  test('набор: лоялист с направлением сам идёт на вахту и становится курсантом', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    const A = sim.academy;
    A.recruiting = true;
    for (const c of sim.entities.list) if (c.faction === 'citizen' && c.profession === 'citizen' && !c.isPlayer) c.loyalty = 60;
    const c = A.recruitNow()!;
    expect(c).toBeTruthy();
    expect(c.brain).toBeInstanceOf(EnlistBrain);
    run(sim, ACADEMY.recruit.walkMax, () => c.faction === 'cp');
    expect(c.faction).toBe('cp');
    expect(c.rank).toBe(CP_UNIT.cdt);
    expect(c.brain).toBeInstanceOf(CadetBrain);
    expect(c.role?.kind).toBe('cadet');
    expect(c.cadet).toBeTruthy();
    expect(sim.log.some((l) => l.includes('новый курсант'))).toBe(true);
  });

  test('занятия по распорядку: строй на плацу, стрельбы в тире (попадания — по пулям), класс', { timeout: 180_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    const A = sim.academy;
    const list = cadets(sim, 4);
    // Построение: все в строю.
    A.sessionEnd = 0;
    run(sim, 1);
    expect(A.session).toBe('formation');
    run(sim, 30);
    const inRanks = list.filter((c) => A.ranks.some((r) => Math.hypot(r.x - c.x, r.y - c.y) < 30)).length;
    expect(inRanks).toBeGreaterThanOrEqual(3);
    // До тира — дальше по распорядку.
    run(sim, 200, () => A.session === 'range');
    expect(A.session).toBe('range');
    const shots0 = A.stats.shots;
    run(sim, 85);
    expect(A.stats.shots - shots0).toBeGreaterThanOrEqual(6);
    expect(A.stats.hits).toBeGreaterThan(0);
    expect(list.some((c) => c.cadet!.shots > 0)).toBe(true);
    // Класс: сидят за партами, после занятия — баллы по теории.
    run(sim, 60, () => A.session === 'class');
    expect(A.session).toBe('class');
    run(sim, 50);
    const seated = list.filter((c) => A.seats.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < 30)).length;
    expect(seated).toBeGreaterThanOrEqual(3);
    run(sim, 30, () => A.session !== 'class');
    expect(list.filter((c) => c.cadet!.theory > 0).length).toBeGreaterThanOrEqual(3);
    expect(list.filter((c) => c.cadet!.fire > 0).length).toBeGreaterThanOrEqual(2);
  });

  test('экзамен и присяга: курсант с баллами сдаёт и занимает вакансию RCT', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    const A = sim.academy;
    const [c] = cadets(sim, 1);
    const N = ACADEMY.exam.need;
    Object.assign(c.cadet!, { drill: N.drill, fitness: N.fitness, theory: N.theory, fire: N.fire, accuracy: 0.8, shots: 10, hits: 8 });
    // Вакансия RCT: погиб постовой.
    const rct = sim.entities.list.find((o) => o.alive && o.faction === 'cp' && o.role?.kind === 'post' && !o.role.access)!;
    const post = rct.role!.post!;
    sim.combat.damage(rct, 9999, null);
    expect(sim.staffing.vacancies('rct').length).toBeGreaterThanOrEqual(1);
    // Экзамен — после класса, присяга — на построении.
    A.examine(c);
    expect(c.cadet!.passed).toBe(true);
    const civil = c.name;
    A.graduate(c);
    expect(c.cadet).toBeNull();
    expect(c.rank).toBe(CP_UNIT.rct);
    expect(c.name).not.toBe(civil);
    expect(c.name.startsWith('ВС-')).toBe(true);
    expect(c.brain).toBeInstanceOf(CpBrain);
    expect(c.role?.kind).toBe('post');
    expect(sim.staffing.slotOf(c)).toBeTruthy();
    // Идёт на пост погибшего.
    run(sim, 120, () => Math.hypot(c.x - post.x, c.y - post.y) < 40);
    expect(Math.hypot(c.x - post.x, c.y - post.y)).toBeLessThan(40);
    expect(sim.log.some((l) => l.includes('Присяга'))).toBe(true);
  });

  test('без вакансии выпускник — в резерве академии; первая вакансия RCT — ему', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    const A = sim.academy;
    const [c] = cadets(sim, 1);
    c.cadet!.passed = true;
    A.graduate(c);
    expect(c.role?.kind).toBe('reserve');
    expect(sim.staffing.reserve).toContain(c);
    const rct = sim.entities.list.find((o) => o.alive && o.faction === 'cp' && o.role?.kind === 'post' && !o.role.access)!;
    sim.combat.damage(rct, 9999, null);
    run(sim, STAFFING.wait + STAFFING.every * 2 + 1, () => c.role?.kind === 'post');
    expect(c.role?.kind).toBe('post');
    expect(sim.staffing.reserve).not.toContain(c);
  });
});

describe('штатное расписание ВС', () => {
  test('погибший ВС не возрождается — должность занимает младший по званию, цепочка вниз', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    const S = sim.staffing;
    const ofc = sim.entities.list.find((c) => c.alive && c.faction === 'cp' && cpUnit(c.rank).unit === 'ofc')!;
    const name = ofc.name;
    // Сержанту — баллов на офицера.
    const sgt = sim.entities.list.find((c) => c.alive && c.faction === 'cp' && cpUnit(c.rank).unit === 'pcu1')!;
    sgt.merit = STAFFING.minScore.ofc + 5;
    const before = sim.entities.list.filter((c) => c.faction === 'cp' && c.alive).length;
    sim.combat.damage(ofc, 9999, null);
    expect(S.vacancies('ofc').length).toBe(1);
    run(sim, STAFFING.wait + STAFFING.every * 3);
    // Офицер не вернулся, его должность занял сержант.
    expect(sim.entities.list.some((c) => c.alive && c.name === name)).toBe(false);
    expect(cpUnit(sgt.rank).unit).toBe('ofc');
    expect(sgt.role?.kind).toBe('officer');
    expect((sgt.brain as CpBrain).duty).toBe('officer');
    expect(S.vacancies('ofc').length).toBe(0);
    // Освободилась должность сержанта — дальше по цепочке (через «врио», если баллов мало).
    run(sim, STAFFING.actingAfter + STAFFING.wait + STAFFING.every * 4);
    expect(S.vacancies('pcu1').length).toBe(0);
    // Никто из ВС не возродился (могли погибнуть ещё — но не прибавиться).
    expect(sim.entities.list.filter((c) => c.faction === 'cp' && c.alive).length).toBeLessThanOrEqual(before - 1);
    expect(sim.roster.pending()).toBe(sim.roster.pending('citizen') + sim.roster.pending('gang') + sim.roster.pending('cwu') + sim.roster.pending('vort') + sim.roster.pending('army') + sim.roster.pending('hydra') + sim.roster.pending('leader') + sim.roster.pending('partisan') + sim.roster.pending('agent') + sim.roster.pending('ota') + sim.roster.pending('trader'));
    expect(S.stats.promotions).toBeGreaterThanOrEqual(2);
    expect(sim.log.some((l) => l.includes('Приказ по силовому блоку'))).toBe(true);
  });

  test('часовой КПП погиб — на его пост переводят из PCU, он бежит на пост', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    const f = sim.war.fronts[0];
    const g0 = sim.entities.list.find((c) => c.alive && c.role?.kind === 'guard' && c.role.front === 0)!;
    const post = g0.role!.post!;
    sim.combat.damage(g0, 9999, null);
    run(sim, STAFFING.actingAfter + STAFFING.wait + 10, () => sim.entities.list.some((c) => c.alive && c !== g0 && c.brain instanceof CpBrain && c.brain.guardPost === post));
    const g = sim.entities.list.find((c) => c.alive && c.brain instanceof CpBrain && c.brain.guardPost === post)!;
    expect(g).toBeTruthy();
    expect(cpUnit(g.rank).unit).toBe('su3');
    expect(g.name).not.toBe(g0.name);
    run(sim, 120, () => Math.hypot(g.x - post.x, g.y - post.y) < 30);
    expect(Math.hypot(g.x - post.x, g.y - post.y)).toBeLessThan(30);
    void f;
  });

  test('игрок-ВС повышается только по баллам: заслуги за задержания', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    const S = sim.staffing;
    const spec = { kind: 'patrol' as const, faction: 'cp' as const, profession: null, division: 'pcu' as const, rank: CP_UNIT.pcu3, kit: 'cp' };
    const p = spawnRole(sim.ctx, spec)!;
    (p as { isPlayer: boolean }).isPlayer = true;
    p.brain = null;
    S.vacate(p);
    p.merit = 0;
    let promoted = -1;
    sim.bus.on('promoted', ({ rank }) => (promoted = rank));
    // Освобождаем должность PCU.02 и запрещаем назначать NPC (у них мало баллов, «врио» ещё рано).
    const lead = sim.entities.list.find((c) => c.alive && !c.isPlayer && cpUnit(c.rank).unit === 'pcu2')!;
    for (const c of sim.entities.list) if (!c.isPlayer && cpUnit(c.rank).unit === 'pcu3') c.merit = 0;
    sim.combat.damage(lead, 9999, null);
    run(sim, STAFFING.wait + STAFFING.every * 2);
    expect(cpUnit(p.rank).unit).toBe('pcu3');
    // Заслуги: задержания.
    S.merit(p, STAFFING.minScore.pcu2 + 1);
    run(sim, STAFFING.every * 2 + 1);
    expect(promoted).toBe(CP_UNIT.pcu2);
    expect(cpUnit(p.rank).unit).toBe('pcu2');
  });
});

describe('пропуска и вахтёры', () => {
  test('без пропуска на объект не войти, пока вахта на месте; курсанту и лоялисту — можно', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    const X = sim.access;
    const A = sim.academy;
    const ts = sim.map.tileSize;
    // Турникет академии: снаружи — вестибюль, внутри — вахта.
    const t = sim.map.poisOf('academy_turnstile')[1];
    const cx = (t.x + 0.5) * ts;
    const cy = (t.y + 0.5) * ts;
    let outside: { x: number; y: number } | null = null;
    let inside: { x: number; y: number } | null = null;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const p = { x: cx + dx * ts * 1.5, y: cy + dy * ts * 1.5 };
      if (X.siteAt(p.x, p.y) === 'academy') inside = p;
      else if (A.inArea('lobby', p.x, p.y)) outside = p;
    }
    expect(outside && inside).toBeTruthy();
    const civ = sim.entities.list.find((c) => c.faction === 'citizen' && !c.isPlayer && c.loyalty < ACCESS.minLoyalty)!;
    civ.brain = null;
    // Шаг «своими ногами» (wantX): втолкнутого толпой вахта возвращает молча и в отказы не пишет.
    const step = (c: Character, to: { x: number; y: number }) => {
      c.wantX = to.x - c.x;
      c.wantY = to.y - c.y;
      c.x = c.prevX = to.x;
      c.y = c.prevY = to.y;
      X.update();
    };
    step(civ, outside!);
    step(civ, inside!);
    expect(X.siteAt(civ.x, civ.y)).toBeNull();
    expect(X.stats.denied).toBe(1);
    // Курсант (форма) — проходит.
    const [cad] = cadets(sim, 1);
    cad.brain = null;
    step(cad, outside!);
    step(cad, inside!);
    expect(X.siteAt(cad.x, cad.y)).toBe('academy');
    // Поиск пути обходит объект, куда не пустят: из вестибюля на плац — пути нет (курсанту — есть).
    const nav = sim.ctx.nav;
    const anchor = (p: { x: number; y: number }) => (Math.floor(p.y / ts) - 1) * nav.w + Math.floor(p.x / ts) - 1;
    const plac = A.areas.plac!;
    const goal = anchor({ x: plac.x + plac.w / 2, y: plac.y + plac.h / 2 });
    const astar = new AStar(nav);
    expect(astar.find(anchor(outside!), goal, { blocked: X.blockerFor(civ) })).toBeNull();
    expect(X.blockerFor(cad)).toBeUndefined();
    expect(astar.find(anchor(outside!), goal, { blocked: X.blockerFor(cad) })).not.toBeNull();
    // Лоялист — в Управу проходит, в академию — нет.
    expect(X.allowed(Object.assign(civ, { loyalty: 70 }), 'nexus')).toBe('yes');
    expect(X.allowed(civ, 'academy')).toBe('no');
    // Вахтёров нет — входи кто хочет.
    for (const g of X.guards('academy')) sim.combat.damage(g, 9999, null);
    run(sim, 1.2);
    civ.loyalty = 0;
    civ.brain = null;
    step(civ, outside!);
    step(civ, inside!);
    expect(X.siteAt(civ.x, civ.y)).toBe('academy');
    // Вошёл, пока вахты не было, — нарушитель (ВС задержит); выведенный под стражей на выход — нет.
    expect(X.trespassing(civ)).toBe(true);
    const out = sim.entities.list.find((c) => c !== civ && c.faction === 'citizen' && !c.isPlayer && c.loyalty < ACCESS.minLoyalty)!;
    out.brain = null;
    out.law.phase = 'releasing';
    step(out, inside!);
    out.law.phase = 'none';
    X.update();
    expect(X.trespassing(out)).toBe(false);
  });

  test('живой пост: RCT осматривается, ходит у поста, переговаривается — не статуя', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    const posts = sim.entities.list.filter((c) => c.alive && c.brain instanceof CpBrain && c.brain.lively);
    expect(posts.length).toBeGreaterThanOrEqual(6);
    const facing0 = new Map(posts.map((c) => [c, c.facing]));
    let moved = 0;
    let talked = 0;
    let turned = 0;
    for (let t = 0; t < 120 * 60; t++) {
      sim.step();
      if (t % 30) continue;
      for (const c of posts) {
        const b = c.brain as CpBrain;
        if (b.postMode === 'beat') moved++;
        if (b.postMode === 'chat') talked++;
        if (Math.abs(c.facing - (facing0.get(c) ?? 0)) > 0.3) turned++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(talked).toBeGreaterThan(0);
    expect(turned).toBeGreaterThan(posts.length * 4);
  });

  test('приток жителей: ушли в академию — в городе появляются новые граждане', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    const count = () => sim.entities.list.filter((c) => c.alive && !c.isPlayer && c.faction === 'citizen' && c.role?.kind === 'citizen').length;
    const n0 = count();
    expect(sim.roster.baseline).toBe(n0);
    cadets(sim, 3);
    expect(count()).toBe(n0 - 3);
    run(sim, 30 * 4 + 2);
    // Погибший в живом мире житель ждёт возрождения — приток считает и его.
    expect(count() + sim.roster.pending('citizen')).toBe(n0);
    expect(sim.roster.arrived).toBe(3);
  });
});
