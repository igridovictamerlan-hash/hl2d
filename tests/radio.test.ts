import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { RADIO } from '../src/config/radio';
import { whereOf } from '../src/world/places';
import { fmt, Radio } from '../src/systems/Radio';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;
const run = (sim: Sim, sec: number, until?: () => boolean) => {
  for (let t = 0; t < sec * 60; t++) {
    sim.step();
    if (until?.()) return true;
  }
  return false;
};

/** Город с составом ВС и немногими жителями; война и подполье не мешают. */
function city(seed = 12345): Sim {
  const sim = makeSim(seed);
  spawnPopulation(sim.ctx, 24);
  sim.war.reinforcements = false;
  sim.insurgency.paused = true;
  sim.war.command.paused = true;
  return sim;
}

/** Свободный патрульный в городе. */
function freeUnit(sim: Sim): Character {
  const u = sim.entities.list.find((c) => c.faction === 'cp' && c.alive && c.brain instanceof CpBrain && c.brain.canRespond(3) && sim.map.levelAt(c.x, c.y) === 'city');
  expect(u).toBeTruthy();
  return u!;
}

/** Точка в городе на улице подальше от юнита (на сети рации). */
function spotFrom(sim: Sim, c: Character, dx: number): { x: number; y: number } {
  for (const k of [1, -1, 0.6, -0.6]) {
    const a = sim.nav.nearestWalkable(c.x + dx * k, c.y, 12);
    if (a < 0) continue;
    const x = sim.nav.worldX(a);
    const y = sim.nav.worldY(a);
    const z = sim.map.zoneAtWorld(x, y)?.kind;
    if (z && ['residential', 'avenue', 'plaza', 'industrial', 'shop'].includes(z)) return { x, y };
  }
  return { x: c.x, y: c.y };
}

const said = (sim: Sim, who: Character | null) => sim.ctx.radio.feed.filter((t) => t.from === who).map((t) => t.text);

describe('рация: места в речи', () => {
  test('предложный падеж названий зон', () => {
    expect(whereOf({ name: 'Заводская улица', kind: 'avenue' })).toBe('на Заводской улице');
    expect(whereOf({ name: 'улица Гидростроителей', kind: 'avenue' })).toBe('на улице Гидростроителей');
    expect(whereOf({ name: 'Главный проспект', kind: 'avenue' })).toBe('на Главном проспекте');
    expect(whereOf({ name: 'Старый квартал', kind: 'residential' })).toBe('в Старом квартале');
    expect(whereOf({ name: 'Рабочий квартал', kind: 'residential' })).toBe('в Рабочем квартале');
    expect(whereOf({ name: 'Складской проезд', kind: 'avenue' })).toBe('на Складском проезде');
    expect(whereOf({ name: 'Общежитие №3', kind: 'residential' })).toBe('в общежитии №3');
    expect(whereOf({ name: 'Пограничный КПП «Запад» · шорт', kind: 'checkpoint' })).toBe('на КПП «Запад», в шорте');
    expect(whereOf({ name: 'Управа — участок ВС', kind: 'nexus' })).toBe('в Управе');
    expect(whereOf({ name: 'Кафе «Старый город»', kind: 'shop' })).toBe('у кафе «Старый город»');
    expect(whereOf(null)).toBe('в городе');
  });

  test('подстановка: с заглавной в начале каждого предложения', () => {
    expect(fmt('{unit}: бежит! {suspect}!', { unit: 'ВС-1', suspect: 'бандит «Литейные»' })).toBe('ВС-1: бежит! Бандит «Литейные»!');
  });
});

describe('рация: вызов и выезд', () => {
  test('доклад → вызов Надзора с местом → подтверждение → едут → «на месте» → «чисто» → отбой', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const reporter = freeUnit(sim);
    const p = spotFrom(sim, reporter, 600);
    const inc = R.report('shots', p.x, p.y, { reporter, what: 'выстрелы в квартале' })!;
    expect(inc).toBeTruthy();
    expect(inc.where.length).toBeGreaterThan(3);
    // Послали ближайших (доложивший тоже идёт — молча).
    const sent = inc.responders.filter((c) => c !== reporter);
    expect(sent.length).toBeGreaterThan(0);
    const u = sent[0];
    expect((u.brain as CpBrain).call?.id).toBe(inc.id);
    // Эфир: доклад доложившего, потом вызов Надзора с местом и позывными, потом «принял».
    run(sim, 12);
    const rep = said(sim, reporter);
    expect(rep.some((t) => t.includes(inc.where))).toBe(true);
    const nad = said(sim, null);
    expect(nad.some((t) => t.includes(inc.where) && t.includes(u.name))).toBe(true);
    expect(said(sim, u).length).toBeGreaterThan(0);
    // Едет и доезжает.
    const d0 = Math.hypot(u.x - inc.x, u.y - inc.y);
    expect(run(sim, 90, () => inc.arrived.has(u) || inc.closed)).toBe(true);
    if (!inc.closed) expect(Math.hypot(u.x - inc.x, u.y - inc.y)).toBeLessThan(Math.max(d0, RADIO.incident.arrive + 1));
    // Тихо — «чисто» и отбой, вызов снят.
    expect(run(sim, 80, () => inc.closed)).toBe(true);
    expect(['clear', 'arrested', 'killed', 'timeout']).toContain(inc.result);
    expect((u.brain as CpBrain).call?.id === inc.id).toBe(false);
    expect(R.stats.arrived).toBeGreaterThan(0);
  });

  test('рядом с открытым — то же происшествие; нападение на юнит — подмога бегом', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const u = freeUnit(sim);
    const p = spotFrom(sim, u, 500);
    const inc = R.report('armed', p.x, p.y, { what: 'вооружённый на улице' })!;
    const before = inc.responders.length;
    const again = R.report('attack', p.x + 40, p.y, { what: 'нападение на сотрудника' });
    expect(again).toBe(inc);
    expect(inc.kind).toBe('attack');
    expect(inc.responders.length).toBeGreaterThan(before);
    expect(inc.responders.some((c) => (c.brain as CpBrain).call?.urgent)).toBe(true);
    expect(R.open.length).toBe(1);
  });

  test('погиб юнит в городе — «потеря биосигнала», на место шлют юниты', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const victim = freeUnit(sim);
    sim.combat.kill(victim, null, 'тест');
    const inc = R.incidents.find((i) => i.kind === 'unitDown')!;
    expect(inc).toBeTruthy();
    expect(inc.victim?.name).toBe(victim.name);
    expect(inc.responders.length).toBeGreaterThan(0);
    run(sim, 6);
    expect(said(sim, null).some((t) => t.includes(victim.name))).toBe(true);
  });

  test('погоня: доклад с приметами, перехват; упустил — ориентировка', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const h = freeUnit(sim);
    const t = sim.entities.list.find((c) => c.faction === 'citizen' && c.alive && sim.map.levelAt(c.x, c.y) === 'city' && R.report !== undefined)!;
    R.chase(h, t);
    const inc = R.incidents.find((i) => i.kind === 'fugitive')!;
    expect(inc.suspect).toBe(t);
    expect(inc.responders.includes(h)).toBe(false);
    run(sim, 10);
    const rep = said(sim, h);
    expect(rep.some((s) => /беглец|бежит|Преследую/i.test(s))).toBe(true);
    expect(rep.some((s) => s.includes(R.describe(t).split(',')[0][0].toUpperCase() + R.describe(t).split(',')[0].slice(1)))).toBe(true);
    R.chaseLost(h, t);
    expect(inc.closed).toBe(true);
    expect(run(sim, 20, () => said(sim, null).some((s) => s.includes('розыск')))).toBe(true);
  });

  test('драка: доклад и ответ Надзора без выезда', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const u = freeUnit(sim);
    const t = sim.entities.list.find((c) => c.faction === 'citizen' && c.alive)!;
    R.brawl(u, t);
    const inc = R.incidents.find((i) => i.kind === 'brawl')!;
    expect(inc.closed).toBe(true);
    expect(inc.responders.length).toBe(0);
    run(sim, 8);
    expect(said(sim, u).some((s) => /драк|мордобой|сцепились/i.test(s))).toBe(true);
  });
});

describe('рация: эфир и плановое', () => {
  test('одна частота: реплики по очереди, не чаще RADIO.gap', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const u = freeUnit(sim);
    for (let k = 0; k < 4; k++) {
      const p = spotFrom(sim, u, 700 + k * 900);
      R.report('sabotage', p.x + k * 700, p.y, { what: 'саботаж' });
    }
    run(sim, 30);
    const t = R.feed.map((f) => f.at);
    expect(t.length).toBeGreaterThan(4);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(RADIO.gap - 1e-6);
  });

  test('пост выходит на связь: доклад по делу и «принято»; эфир не засоряется', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const post = sim.entities.list.find((c) => c.alive && c.brain instanceof CpBrain && c.brain.duty === 'post' && c.brain.guardPost)!;
    expect(post).toBeTruthy();
    expect(R.status(post)).toMatch(/пост|стою|ночь|Людно|пусто/i);
    // Эфир свободен (плановая перекличка не чаще RADIO.routine.checkIn) — пост выходит на связь, второй раз сразу — нет.
    const before = said(sim, post).length;
    expect(run(sim, 90, () => R.queued === 0 && R.checkIn(post))).toBe(true);
    expect(R.checkIn(post)).toBe(false);
    run(sim, 6);
    expect(said(sim, post).length).toBe(before + 1);
    expect(R.feed.some((f) => f.from === null && /Принято|Понял/.test(f.text))).toBe(true);
  });

  test('КПП: гарнизон докладывает о капте, Надзор отвечает; о прорыве знает весь город', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const f = sim.war.fronts[0];
    R.front('capture', f, f.points[0]);
    run(sim, 8);
    const unit = R.feed.find((t) => t.from && (t.from.brain as CpBrain).front === f.index);
    expect(unit?.text).toContain(f.points[0].name);
    expect(said(sim, null).some((t) => t.includes(f.points[0].name))).toBe(true);
    R.front('breach', f, f.points[1]);
    const someone = sim.entities.list.find((c) => c.faction === 'citizen' && c.alive)!;
    expect(sim.ctx.talk.knownBy(someone).some((n) => n.kind === 'breach')).toBe(true);
  });

  test('вызов по рации — юнит прочёсывает место, даже если тревоги в городе нет', () => {
    const sim = city();
    run(sim, 2);
    const u = freeUnit(sim);
    const b = u.brain as CpBrain;
    const p = spotFrom(sim, u, 800);
    b.call = { id: 999, x: p.x, y: p.y, until: sim.law.now + 60, urgent: true, prio: 2 };
    expect(sim.war.alarmActive).toBe(false);
    expect(b.shouldHunt()).toBe(true);
    const d0 = Math.hypot(u.x - p.x, u.y - p.y);
    run(sim, 8);
    expect(b.fsm.current).toBe('hunt');
    expect(Math.hypot(u.x - p.x, u.y - p.y)).toBeLessThan(d0);
    expect(Radio.callOf(u)?.id).toBe(999);
  });
});
