import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { RADIO } from '../src/config/radio';
import { whereOf } from '../src/world/places';
import { fmt, Radio } from '../src/systems/Radio';
import type { Character } from '../src/entities/Character';
import { spawnRole } from '../src/systems/Roster';
import { CP_UNIT, cpUnit } from '../src/config/factions';

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

/** Свободный патрульный в городе (where — ещё условие на юнита). */
function freeUnit(sim: Sim, where: (c: Character) => boolean = () => true): Character {
  const u = sim.entities.list.find((c) => c.faction === 'cp' && c.alive && c.brain instanceof CpBrain && c.brain.canRespond(3) && sim.map.levelAt(c.x, c.y) === 'city' && where(c));
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

/**
 * Первые секунды города (кто-то уже бежит от патруля, пост вышел на связь) занимают единственную частоту и ставят откаты
 * погони и драки — от раскладки карты это зависит. Сценарий теста должен идти по собственным правилам: сбрасываем откаты
 * (они закрывают `chase`/`brawl` на 40–45 с после любого фонового случая) и очередь эфира, а реплики ждём по факту выхода
 * в эфир, а не по часам.
 */
function resetThrottles(sim: Sim): void {
  Object.assign(sim.ctx.radio, { lastChase: -1e9, lastBrawl: -1e9, lastArrest: -1e9, busyUntil: -1e9 });
  // Фоновые передачи в очереди (чужая погоня, переклички) тоже не наши: эфир — сценарию теста.
  (sim.ctx.radio as unknown as { queue: unknown[] }).queue.length = 0;
}

/** Житель на сети рации вдали от открытых происшествий — сюжет не сольётся с фоновым вызовом (RADIO.incident.merge). */
function citizenAway(sim: Sim): Character {
  const R = sim.ctx.radio;
  const c = sim.entities.list.find((p) => {
    if (p.faction !== 'citizen' || !p.alive || sim.map.levelAt(p.x, p.y) !== 'city') return false;
    const z = sim.map.zoneAtWorld(p.x, p.y)?.kind;
    if (!z || !['residential', 'avenue', 'plaza', 'industrial', 'shop'].includes(z)) return false;
    return R.open.every((i) => Math.hypot(i.x - p.x, i.y - p.y) > RADIO.incident.merge + 100);
  });
  expect(c).toBeTruthy();
  return c!;
}

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
    // Частота одна, и фоновые передачи города идут впереди очереди — ждём, пока дойдёт до нашего вызова. В живом
    // городе дело могут закрыть раньше, чем доклад выйдет в эфир (с ним слилась погоня рядом и беглеца взяли), —
    // тогда новый вызов.
    let reporter!: Character;
    let inc!: ReturnType<typeof R.report> & object;
    let u!: Character;
    const aired = () => {
      const f = R.feed;
      const i = f.findIndex((t) => t.from === null && t.text.includes(inc.where) && t.text.includes(u.name));
      return i >= 0 && f.some((t) => t.from === reporter && t.text.includes(inc.where)) && f.slice(i + 1).some((t) => t.from === u);
    };
    for (let k = 0; k < 3; k++) {
      reporter = freeUnit(sim);
      const p = spotFrom(sim, reporter, 600);
      inc = R.report('shots', p.x, p.y, { reporter, what: 'выстрелы в квартале' })!;
      expect(inc).toBeTruthy();
      expect(inc.where.length).toBeGreaterThan(3);
      // Послали ближайших (доложивший тоже идёт — молча).
      const sent = inc.responders.filter((c) => c !== reporter);
      expect(sent.length).toBeGreaterThan(0);
      u = sent[0];
      expect((u.brain as CpBrain).call?.id).toBe(inc.id);
      // Эфир: доклад доложившего, потом вызов Надзора с местом и позывными, потом «принял».
      if (run(sim, 45, () => aired() || inc.closed) && !inc.closed) break;
    }
    expect(aired()).toBe(true);
    const rep = said(sim, reporter);
    expect(rep.some((t) => t.includes(inc.where))).toBe(true);
    const nad = said(sim, null);
    expect(nad.some((t) => t.includes(inc.where) && t.includes(u.name))).toBe(true);
    expect(said(sim, u).length).toBeGreaterThan(0);
    // Едет и доезжает. В живом городе вызов могут закрыть до выезда (слился с соседним делом, подозреваемого взяли) —
    // тогда новый вызов туда же.
    let cur = inc;
    let unit = u;
    expect(run(sim, 90, () => cur.arrived.has(unit) || cur.closed)).toBe(true);
    for (let k = 0; k < 3 && cur.closed && !cur.arrived.has(unit); k++) {
      const q = spotFrom(sim, reporter, 600);
      cur = R.report('shots', q.x, q.y, { reporter, what: 'выстрелы в квартале' })!;
      unit = cur.responders.find((c) => c !== reporter) ?? unit;
      expect(run(sim, 90, () => cur.arrived.has(unit) || cur.closed)).toBe(true);
    }
    // Не закрыт — значит, доехал (дальше он прочёсывает вокруг, и расстояние может снова расти).
    if (!cur.closed) expect(cur.arrived.has(unit)).toBe(true);
    // Тихо — «чисто» и отбой, вызов снят.
    expect(run(sim, 80, () => cur.closed)).toBe(true);
    expect(['clear', 'arrested', 'killed', 'timeout']).toContain(cur.result);
    expect((unit.brain as CpBrain).call?.id === cur.id).toBe(false);
    expect(R.stats.arrived).toBeGreaterThan(0);
  });

  test('рядом с открытым — то же происшествие; нападение на юнит — подмога бегом', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const u = freeUnit(sim);
    const p = spotFrom(sim, u, 500);
    const inc = R.report('armed', p.x, p.y, { what: 'вооружённый на улице' })!;
    // Фоновые вызовы города (погоня на площади) тоже открыты — считаем разницу, а не абсолют.
    const openAfterFirst = R.open.length;
    const before = inc.responders.length;
    // Свободная патрульная группа неподалёку — подмоге есть кого слать (город большой, свободных юнитов мало).
    const lead = CP_UNIT.pcu2;
    spawnRole(sim.ctx, { kind: 'squad', faction: 'cp', profession: null, division: cpUnit(lead).group, rank: lead, kit: cpUnit(lead).kit, squad: 99, lead: true }, spotFrom(sim, u, 300));
    const again = R.report('attack', p.x + 40, p.y, { what: 'нападение на сотрудника' });
    expect(again).toBe(inc);
    expect(inc.kind).toBe('attack');
    expect(inc.responders.length).toBeGreaterThan(before);
    expect(inc.responders.some((c) => (c.brain as CpBrain).call?.urgent)).toBe(true);
    // Второй сигнал слился с первым: нового происшествия не открыли.
    expect(R.open.length).toBe(openAfterFirst);
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
    // Частота одна — вызов Надзора выходит в свой черёд, после фоновых передач.
    expect(run(sim, 45, () => said(sim, null).some((t) => t.includes(victim.name)))).toBe(true);
  });

  test('погоня: доклад с приметами, перехват; упустил — ориентировка', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const h = freeUnit(sim);
    const t = citizenAway(sim);
    resetThrottles(sim);
    R.chase(h, t);
    const inc = R.incidents.find((i) => i.kind === 'fugitive' && i.suspect === t)!;
    expect(inc).toBeTruthy();
    expect(inc.responders.includes(h)).toBe(false);
    run(sim, 45, () => said(sim, h).length > 0);
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
    const t = citizenAway(sim);
    resetThrottles(sim);
    R.brawl(u, t);
    const inc = R.incidents.find((i) => i.kind === 'brawl')!;
    expect(inc).toBeTruthy();
    expect(inc.closed).toBe(true);
    expect(inc.responders.length).toBe(0);
    expect(run(sim, 45, () => said(sim, u).some((s) => /драк|мордобой|сцепились/i.test(s)))).toBe(true);
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
    // Вахтёр у ворот Управы (на постах стены Верхнего города мимо идёт весь проспект — там и свои доклады).
    const post = sim.entities.list.find((c) => c.alive && c.brain instanceof CpBrain && c.brain.duty === 'post' && c.brain.guardPost && c.role?.access === 'nexus')!;
    expect(post).toBeTruthy();
    expect(R.status(post)).toMatch(/пост|стою|ночь|Людно|пусто/i);
    // Эфир свободен (плановая перекличка не чаще RADIO.routine.checkIn) — пост выходит на связь, второй раз сразу — нет.
    // Считаем только доклады о посте: пока ждём, пост может и задержать прохожего («конвоирую задержанного»).
    const reports = () => said(sim, post).filter((t) => /пост|стою|ночь|Людно|пусто/i.test(t)).length;
    const before = reports();
    expect(run(sim, 90, () => R.queued === 0 && R.checkIn(post))).toBe(true);
    expect(R.checkIn(post)).toBe(false);
    run(sim, 6);
    expect(reports()).toBe(before + 1);
    expect(R.feed.some((f) => f.from === null && /Принято|Понял/.test(f.text))).toBe(true);
  });

  test('КПП: гарнизон докладывает о капте, Надзор отвечает; о прорыве знает весь город', () => {
    const sim = city();
    run(sim, 2);
    const R = sim.ctx.radio;
    const f = sim.war.fronts[0];
    R.front('capture', f, f.points[0]);
    // Эфир занят фоновыми передачами — ждём, пока гарнизон КПП доложит, а Надзор ответит.
    const fromGarrison = () => R.feed.find((t) => t.from && (t.from.brain as CpBrain).front === f.index && t.text.includes(f.points[0].name));
    const reply = () => said(sim, null).some((t) => t.includes(f.points[0].name));
    expect(run(sim, 45, () => !!fromGarrison() && reply())).toBe(true);
    const unit = fromGarrison();
    expect(unit?.text).toContain(f.points[0].name);
    expect(said(sim, null).some((t) => t.includes(f.points[0].name))).toBe(true);
    R.front('breach', f, f.points[1]);
    const someone = sim.entities.list.find((c) => c.faction === 'citizen' && c.alive)!;
    expect(sim.ctx.talk.knownBy(someone).some((n) => n.kind === 'breach')).toBe(true);
  });

  test('вызов по рации — юнит прочёсывает место, даже если тревоги в городе нет', () => {
    const sim = city();
    // Без воров и бандитов: юнит по дороге не должен отвлекаться на погоню (сценарий — о вызове, не о нарушителях).
    for (const c of [...sim.entities.list]) if (c.profession === 'bandit' || c.profession === 'thief') sim.entities.remove(c);
    run(sim, 2);
    // Юнит — на улицах города: с ГЭС путь к ним — кругом через ворота, и «ближе» он станет не за полминуты.
    const u = freeUnit(sim, (c) => sim.map.zoneAtWorld(c.x, c.y)?.kind !== 'ges');
    const b = u.brain as CpBrain;
    const p = spotFrom(sim, u, 800);
    b.call = { id: 999, x: p.x, y: p.y, until: sim.law.now + 60, urgent: true, prio: 2 };
    expect(sim.war.alarmActive).toBe(false);
    expect(b.shouldHunt()).toBe(true);
    const d0 = Math.hypot(u.x - p.x, u.y - p.y);
    run(sim, 8);
    expect(b.fsm.current).toBe('hunt');
    // Едет к месту (путь в обход застройки сперва может уводить в сторону — ждём, пока станет ближе).
    expect(run(sim, 30, () => Math.hypot(u.x - p.x, u.y - p.y) < d0 * 0.8)).toBe(true);
    expect(Radio.callOf(u)?.id).toBe(999);
  });
});
