import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { TALK } from '../src/config/talk';
import { LOYALTY } from '../src/config/loyalty';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { gendered, phrase } from '../src/systems/phrases';
import { Rng } from '../src/core/rng';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;
const run = (sim: Sim, sec: number, until?: () => boolean) => {
  for (let t = 0; t < sec * 60; t++) {
    sim.step();
    if (until?.()) return true;
  }
  return false;
};

function city(seed = 12345): Sim {
  const sim = makeSim(seed);
  spawnPopulation(sim.ctx, 30);
  sim.war.reinforcements = false;
  sim.insurgency.paused = true;
  sim.war.command.paused = true;
  return sim;
}

/** Двое горожан (не банды, не лоялисты), стоящие рядом: B приводим к A. */
function pair(sim: Sim, loyA = 0, loyB = 0): [Character, Character] {
  const list = sim.entities.list.filter((c) => c.alive && c.faction === 'citizen' && c.profession === 'citizen' && c.brain instanceof CitizenBrain && c.family < 0 && sim.map.levelAt(c.x, c.y) === 'city');
  const [a, b] = list;
  expect(a && b).toBeTruthy();
  for (const c of [a, b]) {
    c.brain = null;
    c.wantX = c.wantY = 0;
  }
  b.x = b.prevX = a.x + 20;
  b.y = b.prevY = a.y;
  a.loyalty = loyA;
  b.loyalty = loyB;
  return [a, b];
}

describe('разговоры: слухи', () => {
  test('о происшествии знают свидетели; рассказал — собеседник тоже знает', () => {
    const sim = city();
    const T = sim.ctx.talk;
    const [a, b] = pair(sim);
    // B уводим подальше — он не свидетель.
    b.x = b.prevX = a.x + 3000;
    const n = T.event('shots', a.x + 40, a.y, { radius: 200 })!;
    expect(T.knows(a, n)).toBe(true);
    expect(T.knows(b, n)).toBe(false);
    b.x = b.prevX = a.x + 20;
    // A говорит о слухе (других тем у него нет сильнее): B узнаёт.
    let told = false;
    for (let k = 0; k < 12 && !told; k++) {
      const lines = T.dialogue(a, b, 'street');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      told = T.knows(b, n);
    }
    expect(told).toBe(true);
    expect(T.stats.told).toBeGreaterThan(0);
  });

  test('крупное (прорыв, код) знает весь город; родня — про своих', () => {
    const sim = city();
    const T = sim.ctx.talk;
    T.event('breach', 0, 0, { front: 'КПП «Запад»', big: true });
    const citizens = sim.entities.list.filter((c) => c.alive && c.faction === 'citizen');
    expect(citizens.every((c) => T.knownBy(c).some((n) => n.kind === 'breach'))).toBe(true);
    const kin = citizens.find((c) => c.family >= 0)!;
    const other = citizens.find((c) => c.family === kin.family && c !== kin)!;
    const far = { x: other.x + 5000, y: other.y };
    T.event('arrest', far.x, far.y, { who: kin.name, kinOf: kin, radius: 10 });
    expect(T.knownBy(other).some((n) => n.kind === 'arrest' && n.who === kin.name)).toBe(true);
  });
});

describe('разговоры: по делу и по характеру', () => {
  test('ответ зависит от отношения собеседника (лоялист, недовольный)', () => {
    const sim = city();
    const T = sim.ctx.talk;
    const loyalReplies = new Set<string>(TALK.newsTopics.shots.reply.loyal);
    const grumbleReplies = new Set<string>(TALK.newsTopics.shots.reply.grumble);
    const [a, b] = pair(sim, 0, LOYALTY.uniform.min + 5);
    expect(T.attitude(b)).toBe('loyal');
    const n = T.event('shots', a.x, a.y, { radius: 50 })!;
    expect(T.knows(b, n)).toBe(true);
    // B знал — отвечает «слышал»; уводим B, чтобы не знал, и пробуем по новому слуху.
    const replies: string[] = [];
    for (let k = 0; k < 6; k++) {
      b.x = b.prevX = a.x + 4000;
      const m = T.event('shots', a.x, a.y, { radius: 50 })!;
      b.x = b.prevX = a.x + 20;
      const lines = T.dialogue(a, b, 'street');
      if (T.knows(b, m)) replies.push(lines[1].text);
    }
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((r) => loyalReplies.has(r) || !grumbleReplies.has(r))).toBe(true);
    b.loyalty = -20;
    expect(T.attitude(b)).toBe('grumble');
  });

  test('спор лоялиста с недовольным — своя тема', () => {
    const sim = city();
    const T = sim.ctx.talk;
    const [a, b] = pair(sim, LOYALTY.uniform.min + 5, -30);
    const seen = new Set<string>();
    for (let k = 0; k < 30; k++) seen.add(T.dialogue(a, b, 'street')[0].text);
    expect([...seen].some((t) => (TALK.topics.argue.open.loyal ?? []).includes(t))).toBe(true);
  });

  test('родня: собеседник знает, что с родственником (в КПЗ)', () => {
    const sim = city();
    const T = sim.ctx.talk;
    const fam = sim.entities.list.filter((c) => c.alive && c.family >= 0);
    let a: Character | null = null;
    let b: Character | null = null;
    let k: Character | null = null;
    for (const x of fam) {
      const kin = sim.ctx.families.kin(x);
      if (kin.length >= 2) {
        a = x;
        b = kin[0];
        k = kin.filter((o) => o !== b)[x.id % (kin.length - 1)];
        break;
      }
    }
    expect(a && b && k).toBeTruthy();
    k!.law.phase = 'jailed';
    b!.x = b!.prevX = a!.x + 20;
    b!.y = b!.prevY = a!.y;
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      const lines = T.dialogue(a!, b!, 'family');
      found = lines.some((l) => l.who === 1 && l.text.includes(k!.name.split(' ')[0]) && /КПЗ|камер/.test(l.text));
    }
    expect(found).toBe(true);
  });

  test('ВС на посту говорят о последнем вызове по рации', () => {
    const sim = city();
    sim.step();
    const R = sim.ctx.radio;
    const T = sim.ctx.talk;
    const cps = sim.entities.list.filter((c) => c.alive && c.faction === 'cp');
    const [a, b] = cps;
    const inc = R.report('sabotage', a.x + 200, a.y, { what: 'саботаж узла Протектората' })!;
    expect(inc).toBeTruthy();
    let found = false;
    for (let i = 0; i < 40 && !found; i++) found = T.dialogue(a, b, 'post').some((l) => l.text.includes(inc.where));
    expect(found).toBe(true);
  });
});

describe('разговоры: без повторов и с родом', () => {
  test('род: {м|ж} — по говорящему, [м|ж] — по собеседнику', () => {
    const sim = city();
    const all = sim.entities.list.filter((c) => c.faction === 'citizen');
    const f = all.find((c) => /^(Мария|Анна|Ольга|Елена|Ирина) /.test(c.name))!;
    const m = all.find((c) => /^(Иван|Алексей|Дмитрий|Сергей|Павел) /.test(c.name))!;
    expect(gendered('Я ничего не {говорил|говорила}.', f, m)).toBe('Я ничего не говорила.');
    expect(gendered('[Слышал|Слышала]? Стреляли.', m, f)).toBe('Слышала? Стреляли.');
    expect(gendered('[Слышал|Слышала]? Стреляли.', f, m)).toBe('Слышал? Стреляли.');
  });

  test('одному человеку подряд — разные фразы, пока список не исчерпан', () => {
    const sim = city();
    const c = sim.entities.list.find((x) => x.faction === 'citizen')!;
    const list = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    const rng = new Rng(5);
    const got = Array.from({ length: 6 }, () => phrase(rng, c, list));
    expect(new Set(got).size).toBe(6);
    // Дальше — снова все, без двух одинаковых подряд.
    const more = Array.from({ length: 12 }, () => phrase(rng, c, list));
    for (let i = 1; i < more.length; i++) expect(more[i]).not.toBe(more[i - 1]);
  });

  test('реплики одного: слух или обстановка, без повторов подряд', () => {
    const sim = city();
    const T = sim.ctx.talk;
    const c = sim.entities.list.find((x) => x.faction === 'citizen' && x.alive)!;
    T.event('riot', c.x, c.y, { radius: 50 });
    const said = Array.from({ length: 10 }, () => T.remark(c, 'barrel', ['раз', 'два', 'три', 'четыре', 'пять', 'шесть']));
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
    expect(new Set(said).size).toBeGreaterThanOrEqual(6);
  });
});

describe('разговоры: беседа в мире', () => {
  test('беседа идёт по репликам по очереди; разошлись — прервалась', () => {
    const sim = city();
    const T = sim.ctx.talk;
    const [a, b] = pair(sim);
    expect(T.converse(a, b, 'street')).toBe(true);
    expect(T.busy(a) && T.busy(b)).toBe(true);
    expect(T.converse(a, b, 'street')).toBe(false);
    const texts: string[] = [];
    for (let t = 0; t < 60 * 6; t++) {
      sim.step();
      for (const c of [a, b]) if (c.speech && c.speech.kind === 'say' && !texts.includes(c.speech.text)) texts.push(c.speech.text);
    }
    expect(texts.length).toBeGreaterThanOrEqual(2);
    expect(T.converse(a, b, 'street')).toBe(true);
    b.x = b.prevX = a.x + 2000;
    sim.step();
    expect(T.busy(a)).toBe(false);
    expect(T.stats.cut).toBeGreaterThan(0);
  });

  test('город за две минуты: жители беседуют, договаривают темы, слухи расходятся', { timeout: 90_000 }, () => {
    const sim = city(777);
    run(sim, 120);
    const S = sim.ctx.talk.stats;
    expect(S.convos).toBeGreaterThan(8);
    expect(S.lines).toBeGreaterThan(S.convos);
    expect(S.done).toBeGreaterThan(S.cut);
    expect(Object.keys(S.topics).length).toBeGreaterThan(4);
  });
});
