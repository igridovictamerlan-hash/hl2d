import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { createCharacter } from '../src/entities/factory';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { personaFor, TRAITS } from '../src/systems/Persona';
import { RELATIONS } from '../src/config/relations';
import { ITEMS } from '../src/config/items';
import { EntityRenderer } from '../src/entities/EntityRenderer';
import { gendered } from '../src/systems/phrases';
import { fmt } from '../src/systems/Radio';
import { randomAnchorAround } from '../src/ai/destinations';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

/** Прокрутить время закона вперёд (остывание обид, откаты) без шагов мира. */
const skip = (sim: Sim, sec: number): void => {
  (sim.law as unknown as { time: number }).time += sec;
};

const run = (sim: Sim, sec: number, until?: () => boolean): boolean => {
  for (let t = 0; t < sec * 60; t++) {
    sim.step();
    if (until?.()) return true;
  }
  return false;
};

function city(seed = 12345, n = 40): Sim {
  const sim = makeSim(seed);
  spawnPopulation(sim.ctx, n);
  sim.war.reinforcements = false;
  sim.insurgency.paused = true;
  sim.war.command.paused = true;
  return sim;
}

/** Номер человека с нужной чертой: ищем среди первых тысяч. */
function pidWith(trait: (typeof TRAITS)[number], high: boolean, not = -1): number {
  for (let pid = 1; pid < 5000; pid++) {
    if (pid === not) continue;
    const p = personaFor(pid, 'citizen', 'citizen');
    if (high ? p[trait] > 0.88 : p[trait] < 0.12) return pid;
  }
  throw new Error('нет такого характера');
}

/** Горожане без банды, друг с другом не родня (пары берём по порядку). */
function folks(sim: Sim, n: number): Character[] {
  const out: Character[] = [];
  for (const c of sim.entities.list) {
    if (c.alive && c.faction === 'citizen' && c.profession === 'citizen' && c.gang < 0 && c.brain instanceof CitizenBrain && sim.map.levelAt(c.x, c.y) === 'city' && !out.some((o) => o.family >= 0 && o.family === c.family)) out.push(c);
    if (out.length === n) break;
  }
  expect(out.length).toBe(n);
  return out;
}

/** Поставить b рядом с a (в нескольких пикселях, лицом друг к другу), без мозгов-помех. */
function near(sim: Sim, a: Character, b: Character, d = 1.5): void {
  const n = randomAnchorAround(a, sim.ctx, 1, d, new Set());
  b.x = b.prevX = sim.nav.worldX(n);
  b.y = b.prevY = sim.nav.worldY(n);
  a.facing = Math.atan2(b.y - a.y, b.x - a.x);
  b.facing = Math.atan2(a.y - b.y, a.x - b.x);
  // Пространственный хэш знает прежние места: без этого «кто рядом» не найдёт перенесённого.
  sim.entities.rebuildHash();
}

/** Все ВС дальше r px от точки c (иначе при них недруги не лезут драться). */
function copsAway(sim: Sim, c: Character, r = 900): void {
  for (const o of sim.entities.list) {
    if (o.faction !== 'cp' || Math.hypot(o.x - c.x, o.y - c.y) > r) continue;
    o.x = o.prevX = c.x + r * 3;
    o.y = o.prevY = c.y;
  }
  sim.entities.rebuildHash();
}

/** Задать человеку характер: подменить номер (характер выводится из него). */
function withPid(sim: Sim, c: Character, pid: number): void {
  c.pid = pid;
  sim.ctx.relations.register(c);
}

function player(sim: Sim, at: Character): Character {
  const p = createCharacter(sim.entities, sim.ctx.rng, 'citizen', at.x, at.y, true);
  sim.ctx.player = p;
  sim.ctx.relations.register(p);
  return p;
}

describe('характер', () => {
  test('черты стабильны и в пределах; у бандитов вспыльчивость выше; у ярких черт есть слова', () => {
    expect(personaFor(101, 'citizen', 'citizen')).toEqual(personaFor(101, 'citizen', 'citizen'));
    let cit = 0;
    let bandit = 0;
    for (let pid = 1; pid <= 300; pid++) {
      const p = personaFor(pid, 'citizen', 'citizen');
      for (const t of TRAITS) {
        expect(p[t]).toBeGreaterThanOrEqual(0);
        expect(p[t]).toBeLessThanOrEqual(1);
      }
      expect(p.tags.length).toBeLessThanOrEqual(RELATIONS.persona.maxTags);
      for (const h of Object.values(p.habit)) {
        expect(h).toBeGreaterThanOrEqual(RELATIONS.persona.habit.lo - 1e-9);
        expect(h).toBeLessThanOrEqual(RELATIONS.persona.habit.hi + 1e-9);
      }
      cit += p.temper;
      bandit += personaFor(pid, 'citizen', 'bandit').temper;
    }
    expect(bandit - cit).toBeGreaterThan(300 * 0.15);
    const hot = personaFor(pidWith('temper', true), 'citizen', 'citizen');
    expect(hot.tags).toContain('вспыльчивый');
    const shy = personaFor(pidWith('brave', false), 'citizen', 'citizen');
    expect(shy.tags).toContain('робкий');
  });
});

describe('первичные связи города', () => {
  test('родня знакома и дружна, у жителей есть друзья, у части — недруги, банды враждуют', () => {
    const sim = city(12345, 60);
    const R = sim.ctx.relations;
    const fam = sim.ctx.families.families.find((f) => sim.entities.list.filter((c) => c.family === f.id).length >= 2)!;
    const [a, b] = sim.entities.list.filter((c) => c.family === fam.id);
    expect(R.isKin(a, b)).toBe(true);
    expect(R.opinion(a, b)).toBeGreaterThan(20);
    expect(R.knows(a, b)).toBe(true);
    const folk = sim.entities.list.filter((c) => c.faction === 'citizen' && c.gang < 0 && c.profession === 'citizen');
    const withFriends = folk.filter((c) => R.circle(c, 'friends', false).length > 0).length;
    expect(withFriends / folk.length).toBeGreaterThan(0.5);
    const withFoes = folk.filter((c) => R.circle(c, 'rivals').length > 0).length;
    expect(withFoes).toBeGreaterThan(0);
    // Банда — братва; чужая банда — давняя вражда.
    const [g1, g2] = sim.ctx.gangs.gangs;
    const m1 = sim.ctx.gangs.members(g1);
    const m2 = sim.ctx.gangs.members(g2);
    expect(R.tier(m1[0], m1[1])).not.toBe('stranger');
    expect(R.opinion(m1[0], m1[1])).toBeGreaterThan(20);
    expect(m1.some((x) => m2.some((y) => R.opinion(x, y) < -30))).toBe(true);
  });
});

describe('события и память', () => {
  test('удар: пострадавший и свидетель мрачнеют к обидчику, обида помнится, потом остывает', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [a, v, w] = folks(sim, 3);
    near(sim, a, v);
    near(sim, a, w, 3);
    const mood0 = R.mood(v);
    R.event('hit', a, v);
    expect(R.opinion(v, a)).toBeLessThan(-10);
    expect(R.knows(v, a)).toBe(true);
    expect(R.bond(v, a)!.mem.some((m) => m.kind === 'beat')).toBe(true);
    expect(R.opinion(w, a)).toBeLessThan(0);
    expect(R.mood(v)).toBeLessThan(mood0 - 8);
    expect(R.tier(v, a)).not.toBe('stranger');
    // Через полчаса обида почти остыла.
    const after = R.opinion(v, a);
    skip(sim, 1800);
    expect(R.opinion(v, a)).toBeGreaterThan(after);
    expect(R.opinion(v, a)).toBeGreaterThan(after * 0.5);
  });

  test('злопамятный помнит обиду дольше отходчивого', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [a, v1, v2] = folks(sim, 3);
    withPid(sim, v1, pidWith('grudge', true));
    withPid(sim, v2, pidWith('grudge', false, v1.pid));
    near(sim, a, v1);
    near(sim, a, v2);
    R.link(v1, a, 0, 20, 0, false);
    R.link(v2, a, 0, 20, 0, false);
    R.event('insult', a, v1);
    R.event('insult', a, v2);
    skip(sim, 600);
    expect(R.opinion(v1, a)).toBeLessThan(R.opinion(v2, a));
  });

  test('помощь и угощение сближают: знакомый → приятель, игроку — строка в журнал', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [n] = folks(sim, 1);
    const p = player(sim, n);
    near(sim, n, p);
    for (let k = 0; k < 4; k++) {
      R.event(k % 2 ? 'feed' : 'help', p, n);
      skip(sim, 100);
    }
    expect(R.opinion(n, p)).toBeGreaterThan(RELATIONS.bond.tiers.friend.opinion);
    expect(['friend', 'close']).toContain(R.tier(n, p));
    expect(sim.log.some((l) => /теперь знает вас/.test(l))).toBe(true);
    expect(sim.log.some((l) => /теперь вы — (приятель|близкий друг)/.test(l))).toBe(true);
    expect(R.info(n, p).tier).toBe(R.tier(n, p));
  });

  test('разговор знакомит незнакомцев', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [a, b] = folks(sim, 2);
    for (const c of [a, b]) {
      c.brain = null;
      c.wantX = c.wantY = 0;
    }
    near(sim, a, b);
    expect(R.knows(a, b)).toBe(false);
    for (let k = 0; k < 4 && !R.knows(a, b); k++) {
      expect(sim.ctx.talk.converse(a, b, 'street')).toBe(true);
      run(sim, 30, () => !sim.ctx.talk.busy(a));
      skip(sim, 60);
    }
    expect(R.knows(a, b)).toBe(true);
    expect(R.knows(b, a)).toBe(true);
    expect(R.opinion(a, b)).toBeGreaterThan(0);
  });

  test('кража: жертва и свидетели запоминают вора', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [t, v, w] = folks(sim, 3);
    near(sim, t, v);
    near(sim, t, w, 3);
    v.money = 80;
    sim.ctx.crime.rob(t, v);
    expect(R.opinion(v, t)).toBeLessThan(-15);
    expect(R.bond(v, t)!.mem.some((m) => m.kind === 'robbed')).toBe(true);
    expect(R.opinion(w, t)).toBeLessThan(0);
    expect(R.thoughtsOf(v).some((x) => x.kind === 'robbed')).toBe(true);
  });

  test('арест: близкий арестованного обижен на ВС и подавлен', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [t, f] = folks(sim, 2);
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && c.alive)!;
    R.link(f, t, 60, 50);
    near(sim, t, f, 3);
    cp.x = cp.prevX = t.x + 20;
    cp.y = cp.prevY = t.y;
    const mood0 = R.mood(f);
    sim.law.arrest(cp, t, 'routine');
    expect(R.opinion(t, cp)).toBeLessThan(-10);
    expect(R.opinion(f, cp)).toBeLessThan(0);
    expect(R.thoughtsOf(f).some((x) => x.kind === 'friendArrested')).toBe(true);
    expect(R.mood(f)).toBeLessThan(mood0);
  });
});

describe('гибель и возрождение', () => {
  test('гибель друга: горе, обида на убийцу; возродившийся забывает убийцу, но не друзей', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [a, b, k] = folks(sim, 3);
    R.link(a, b, 70, 60);
    near(sim, a, b, 2);
    near(sim, a, k, 3);
    const mood0 = R.mood(a);
    const spec = { ...b.role!, pid: b.pid };
    sim.ctx.combat.kill(b, k);
    expect(R.thoughtsOf(a).some((x) => x.kind === 'friendDied')).toBe(true);
    expect(R.mourning(a)).toBeGreaterThan(0);
    expect(R.mood(a)).toBeLessThan(mood0 - 20);
    // Убийцу видел — не простит.
    expect(R.opinion(a, k)).toBeLessThan(-40);
    // Родня — ещё сильнее.
    // Возрождение: тот же человек (номер прежний), друзья на месте, убийцу не помнит.
    const c = spawnRole(sim.ctx, spec, { x: b.x, y: b.y })!;
    expect(c.pid).toBe(b.pid);
    expect(R.opinion(c, a)).toBeGreaterThan(40);
    expect(R.bond(c, k)?.mem.some((m) => m.kind === 'beat' || m.kind === 'shot') ?? false).toBe(false);
    expect(R.thoughtsOf(c).length).toBe(0);
  });

  test('горюющий житель чаще сидит дома', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a, b] = folks(sim, 2);
    R.link(a, b, 80, 70, 1);
    near(sim, a, b);
    sim.ctx.combat.kill(b, null);
    const brain = a.brain as CitizenBrain;
    brain.fsm.change('idle');
    let home = 0;
    for (let k = 0; k < 10; k++) {
      if (brain.decide() === 'home') home++;
    }
    expect(home).toBeGreaterThanOrEqual(4);
  });
});

describe('жизнь на улице', () => {
  const idle = (c: Character): void => {
    (c.brain as CitizenBrain).fsm.change('idle');
    c.law.lastCheck = 1e9;
  };

  test('знакомые здороваются по имени, друзья останавливаются поболтать', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a, b] = folks(sim, 2);
    withPid(sim, a, pidWith('social', true));
    near(sim, a, b);
    idle(a);
    idle(b);
    R.link(a, b, 55, 45);
    let chatted = false;
    for (let k = 0; k < 30 && !chatted; k++) {
      R['scan'](a);
      chatted = (a.brain as CitizenBrain).partner === b;
      skip(sim, 200);
      for (const c of [a, b]) {
        c.brain = new CitizenBrain(c, sim.ctx);
        idle(c);
      }
      near(sim, a, b);
    }
    expect(R.stats.greets).toBeGreaterThan(0);
    expect(a.speech?.text ?? '').not.toBe('');
    expect(R.opinion(b, a)).toBeGreaterThan(40);
    // Общительный друг, встретив друга, останавливается поболтать — хоть раз за эти встречи.
    expect(chatted).toBe(true);
  });

  test('недруг: взгляд и стычка, а при ВС рядом — ни драки, ни расправы', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a, b] = folks(sim, 2);
    withPid(sim, a, pidWith('temper', true));
    near(sim, a, b);
    idle(a);
    idle(b);
    R.link(a, b, -70, 40, 0, false);
    // Рядом патруль — стычки нет.
    copsAway(sim, a);
    const cp = sim.entities.list.find((c) => c.faction === 'cp' && c.alive)!;
    cp.x = cp.prevX = a.x + 30;
    cp.y = cp.prevY = a.y;
    sim.entities.rebuildHash();
    for (let k = 0; k < 14; k++) {
      R['scan'](a);
      skip(sim, 200);
    }
    expect(sim.ctx.brawls.fighting(a)).toBe(false);
    expect(R.stats.confronts + R.stats.revenges).toBe(0);
    expect(R.stats.glares).toBeGreaterThan(0);
    // ВС ушёл — недруги сцепятся.
    copsAway(sim, a);
    for (let k = 0; k < 24 && !sim.ctx.brawls.fighting(a); k++) {
      near(sim, a, b);
      idle(a);
      idle(b);
      R['scan'](a);
      skip(sim, 220);
    }
    expect(sim.ctx.brawls.fighting(a)).toBe(true);
    expect(R.stats.confronts + R.stats.revenges).toBeGreaterThan(0);
  });

  test('месть: избитый злопамятный встречает обидчика — драка', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [a, v] = folks(sim, 2);
    withPid(sim, v, pidWith('grudge', true));
    near(sim, a, v);
    R.event('hit', a, v);
    skip(sim, 120);
    R.link(v, a, -55, 30, 0, false);
    expect(R.bond(v, a)!.mem.some((m) => m.kind === 'beat')).toBe(true);
    R.social = true;
    let fought = false;
    for (let k = 0; k < 40 && !fought; k++) {
      copsAway(sim, v);
      near(sim, v, a);
      idle(v);
      idle(a);
      R['scan'](v);
      skip(sim, 220);
      fought = sim.ctx.brawls.fighting(v);
    }
    expect(fought).toBe(true);
    expect(R.stats.revenges + R.stats.confronts).toBeGreaterThan(0);
  });

  test('голодному делится друг: хлеб из рук в руки, мнение растёт', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a, b] = folks(sim, 2);
    near(sim, a, b);
    R.link(a, b, 60, 50);
    a.inventory.clear();
    a.hunger = 18;
    b.hunger = 90;
    b.inventory.add('bread', 3);
    idle(a);
    idle(b);
    const before = R.opinion(a, b);
    const food = (c: Character) => c.inventory.slots.reduce((n, s) => n + (ITEMS[s.id].food ? s.qty : 0), 0);
    const had = food(b);
    R['scan'](a);
    run(sim, 4, () => R.stats.shares > 0);
    // Съестное ушло от друга (самое скромное — лишнее отдают); голодный тут же съел его (NPC едят сами).
    expect(R.stats.shares).toBe(1);
    expect(food(b)).toBe(had - 1);
    run(sim, 2);
    expect(a.hunger).toBeGreaterThan(18);
    expect(R.opinion(a, b)).toBeGreaterThan(before);
    expect(R.bond(a, b)!.mem.some((m) => m.kind === 'fed')).toBe(true);
  });

  test('близкий вступается в драке на кулаках, но не толпой', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a, v, f, g] = folks(sim, 4);
    withPid(sim, f, pidWith('brave', true));
    withPid(sim, g, pidWith('brave', true, f.pid));
    near(sim, a, v);
    near(sim, v, f, 3);
    near(sim, v, g, 3);
    R.link(f, v, 90, 70);
    R.link(g, v, 90, 70);
    for (const c of [a, v, f, g]) idle(c);
    copsAway(sim, v);
    const against = (c: Character) => sim.ctx.brawls.list.some((x) => (x.a === c || x.b === c) && (x.a === a || x.b === a));
    const reset = (): void => {
      sim.ctx.brawls.list.length = 0;
      for (const c of [a, v, f, g]) {
        c.nextShot = 0;
        c.stunUntil = 0;
        c.health = c.maxHealth;
        idle(c);
      }
    };
    // Бьют именно пострадавшего (расстановка по якорям случайна: зевака мог оказаться на линии удара).
    for (let k = 0; k < 20 && !R.stats.defends; k++) {
      sim.ctx.combat.punch(a, v.x, v.y, v);
      if (R.stats.defends) break;
      skip(sim, 30);
      reset();
    }
    const first = R.stats.defends;
    expect(first).toBe(1);
    expect(against(f) || against(g)).toBe(true);
    expect(R.bond(v, f)!.mem.some((m) => m.kind === 'defended') || R.bond(v, g)!.mem.some((m) => m.kind === 'defended')).toBe(true);
    // Сразу ещё удар: на пострадавшего откат — второй заступник не набегает, драка не разрастается в свалку.
    a.nextShot = 0;
    sim.ctx.combat.punch(a, v.x, v.y, v);
    expect(R.stats.defends).toBe(first);
    expect(sim.ctx.brawls.list.filter((x) => x.a === a || x.b === a).length).toBeLessThanOrEqual(RELATIONS.allies.maxOnAttacker);
  });

  test('недруг не станет говорить: отказ и осадок', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a, b] = folks(sim, 2);
    R.link(b, a, -50, 40, 0, false);
    expect(R.willTalk(b, a)).toBe(false);
    const op = R.opinion(a, b);
    R.rebuff(b, a);
    expect(R.opinion(a, b)).toBeLessThanOrEqual(op);
    expect(b.speech).not.toBeNull();
    expect(R.stats.rebuffs).toBe(1);
  });

  test('друзья ссорятся реже, недруги — чаще', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a, b, c] = folks(sim, 3);
    R.link(a, b, 70, 60);
    R.link(a, c, -70, 40);
    expect(R.quarrelMul(a, b)).toBeLessThan(0.3);
    expect(R.quarrelMul(a, c)).toBeGreaterThan(R.quarrelMul(a, b) * 8);
  });
});

describe('игрок', () => {
  test('E перед человеком: знакомство, откат, просьба о еде и угощение', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [n] = folks(sim, 1);
    n.hunger = 10;
    n.inventory.clear();
    const p = player(sim, n);
    near(sim, n, p);
    p.inventory.add('bread', 2);
    expect(R.knows(n, p)).toBe(false);
    expect(R.interact(p, n)).toBe('');
    expect(R.knows(n, p)).toBe(true);
    expect(R.stats.talks).toBe(1);
    expect(p.speech).not.toBeNull();
    // Слишком часто — подождите.
    expect(R.interact(p, n)).toMatch(/занят разговором/);
    // Голодный просит еду — через несколько секунд.
    run(sim, 8, () => R['psy'](n.pid).askUntil > sim.law.now);
    expect(R['psy'](n.pid).askUntil).toBeGreaterThan(sim.law.now);
    const op = R.opinion(n, p);
    const hunger = n.hunger;
    expect(R.interact(p, n)).toMatch(/накормили/);
    expect(p.inventory.count('bread')).toBe(1);
    expect(n.hunger).toBeGreaterThan(hunger);
    expect(R.opinion(n, p)).toBeGreaterThan(op);
    // Знакомые игрока — в панели.
    const list = R.contacts(p);
    expect(list.some((i) => i.pid === n.pid)).toBe(true);
    expect(list[0].memory).toBeTruthy();
  });

  test('чужой человек в плохом настроении не болтает с незнакомцем, друг — рад', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [n, f] = folks(sim, 2);
    const p = player(sim, n);
    near(sim, n, p);
    R.link(n, p, -60, 30, 0, false);
    expect(R.interact(p, n)).toBe('');
    expect(R.stats.talks).toBe(1);
    run(sim, 3);
    expect(n.speech).not.toBeNull();
    expect(R.opinion(n, p)).toBeLessThanOrEqual(-55);
    // Друг отвечает тепло.
    near(sim, f, p);
    R.link(f, p, 60, 50, 0, false);
    skip(sim, 100);
    R.interact(p, f);
    run(sim, 3);
    expect(f.speech?.text ?? '').not.toBe('');
  });

  test('ответ на приветствие вслух зависит от знакомства', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [n] = folks(sim, 1);
    const p = player(sim, n);
    near(sim, n, p);
    R.link(n, p, 60, 50, 0, false);
    const reply = R.greetReply(n, p);
    expect(reply.length).toBeGreaterThan(2);
    expect(R.opinion(p, n)).toBeGreaterThan(0);
  });
});

describe('мелочи живых людей', () => {
  test('продавец помнит покупателя: другу — скидка, недругу — надбавка, врагу не продаст', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const shop = sim.ctx.shops.shops.find((x) => x.vendor && x.vendorSpot && x.sub !== 'cwu' && x.stock.length)!;
    expect(shop).toBeTruthy();
    const v = shop.vendor!;
    const [b] = folks(sim, 1);
    shop.goods = shop.cap;
    sim.ctx.shops.update();
    const id = shop.stock.find((i) => ITEMS[i].price !== undefined && !ITEMS[i].gear)!;
    const base = sim.economy.shopPrice(b, id)!;
    expect(R.priceMul(v, b)).toBe(1);
    R.link(v, b, 60, 50, 0, false);
    expect(R.priceMul(v, b)).toBeLessThan(1);
    expect(sim.economy.shopPrice(b, id, R.priceMul(v, b))!).toBeLessThanOrEqual(base);
    b.money = 500;
    const before = b.money;
    expect(sim.ctx.shops.buy(b, shop, id)).toBeNull();
    expect(before - b.money).toBe(sim.economy.shopPrice(b, id, R.priceMul(v, b)));
    expect(R.knows(v, b)).toBe(true);
    // Недоброжелатель платит больше, враг — не покупает.
    R.link(v, b, -35, 40, 0, false);
    expect(R.priceMul(v, b)).toBeGreaterThan(1);
    R.link(v, b, -80, 40, 0, false);
    expect(R.willServe(v, b)).toBe(false);
    const money = b.money;
    expect(sim.ctx.shops.buy(b, shop, id)).toMatch(/не хочет вас обслуживать/);
    expect(b.money).toBe(money);
  });

  test('посылка доставлена — адресат запомнил, кто принёс', () => {
    const sim = city();
    const R = sim.ctx.relations;
    R.social = false;
    const [n] = folks(sim, 1);
    const p = player(sim, n);
    const d = sim.ctx.housing.of(n)!;
    p.x = p.prevX = d.at.x;
    p.y = p.prevY = d.at.y;
    p.inventory.add('parcel', 1);
    sim.ctx.errands.active = { secret: false, to: d, who: n, name: n.name, zone: 'тест', until: 1e9 };
    expect(sim.ctx.errands.deliver(p)).toBeTruthy();
    expect(R.knows(n, p)).toBe(true);
    expect(R.opinion(n, p)).toBeGreaterThan(5);
    expect(R.bond(n, p)!.mem.some((m) => m.kind === 'gift')).toBe(true);
  });

  test('у жителя с домом есть знакомые соседи', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [n] = folks(sim, 1);
    const p = player(sim, n);
    sim.ctx.housing.house(p, null);
    R.seedPlayer(p);
    const list = R.contacts(p);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((i) => i.tier === 'acquaintance')).toBe(true);
  });

  test('человек после возрождения выглядит прежним; настроение меняет шаг, храбрость — панику', () => {
    const sim = city();
    const R = sim.ctx.relations;
    const [a] = folks(sim, 1);
    const view = new EntityRenderer();
    const spec = { ...a.role!, pid: a.pid };
    const look = view.lookOf(a).seed;
    sim.ctx.combat.kill(a, null);
    const c = spawnRole(sim.ctx, spec, { x: a.x, y: a.y })!;
    expect(c.id).not.toBe(a.id);
    expect(view.lookOf(c).seed).toBe(look);
    // Горе тормозит шаг, довольный идёт бодрее.
    withPid(sim, c, pidWith('temper', false));
    const calm = R.paceMul(c);
    R.think(c, 'kinDied', 1);
    R.think(c, 'kinDied', 2);
    expect(R.paceMul(c)).toBeLessThan(calm);
    withPid(sim, c, pidWith('brave', true));
    const brave = R.panicMul(c);
    withPid(sim, c, pidWith('brave', false));
    expect(R.panicMul(c)).toBeGreaterThan(brave);
  });
});

describe('реплики', () => {
  test('все шаблоны раскрываются без хвостов: род, подстановки, скобки', () => {
    const he = { faction: 'citizen', name: 'Пётр Иванов', disguised: false, cover: null } as unknown as Character;
    const she = { faction: 'citizen', name: 'Мария Зайцева', disguised: false, cover: null } as unknown as Character;
    const vars = { aname: 'Пётр', bname: 'Мария', who: 'Иван Новак', why: 'драку', tier: 'приятель', n: 2 };
    const seen: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'string') {
        for (const [a, b] of [[he, she], [she, he]] as const) {
          const out = fmt(gendered(v, a, b), vars);
          expect(out, `${path}: ${v}`).not.toMatch(/[{}[\]]|undefined|NaN/);
          expect(out.length, path).toBeGreaterThan(0);
        }
        seen.push(path);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(RELATIONS.lines, 'lines');
    walk(RELATIONS.topics, 'topics');
    walk(RELATIONS.dialog.say, 'say');
    walk(RELATIONS.dialog.reply, 'reply');
    walk(RELATIONS.dialog.ask, 'ask');
    walk(RELATIONS.dialog.fed, 'fed');
    walk(RELATIONS.dialog.full, 'full');
    expect(seen.length).toBeGreaterThan(200);
  });
});

describe('сохранение', () => {
  test('связи и воспоминания возвращаются тем же людям, чужим — нет', () => {
    const sim = city(12345, 40);
    const R = sim.ctx.relations;
    R.social = false;
    const [a, b, c] = folks(sim, 3);
    near(sim, a, b);
    R.event('hit', a, b);
    R.link(a, c, 61, 77);
    const data = JSON.parse(JSON.stringify(R.serialize()));
    expect(data.bonds.length).toBeGreaterThan(50);
    // Тот же город — те же люди.
    const sim2 = city(12345, 40);
    const R2 = sim2.ctx.relations;
    const a2 = sim2.entities.byId(a.id)!;
    const b2 = sim2.entities.byId(b.id)!;
    const c2 = sim2.entities.byId(c.id)!;
    expect(a2.name).toBe(a.name);
    R2.restore(data);
    expect(R2.opinion(b2, a2)).toBeCloseTo(R.opinion(b, a), 0);
    expect(R2.bond(b2, a2)!.mem.some((m) => m.kind === 'beat')).toBe(true);
    expect(R2.opinion(a2, c2)).toBeCloseTo(61, 0);
    // Другой город: те же номера, другие имена — ничего не переносится.
    const sim3 = city(777, 40);
    const R3 = sim3.ctx.relations;
    const x = sim3.entities.byId(a.id)!;
    const y = sim3.entities.byId(c.id)!;
    const before = R3.opinion(x, y);
    R3.restore(data);
    expect(R3.opinion(x, y)).toBe(before);
  });
});

describe('мир целиком', () => {
  test('шесть минут города: люди здороваются и беседуют, связей не больше предела, настроение в пределах', { timeout: 300_000 }, () => {
    const sim = city(12345, 70);
    const R = sim.ctx.relations;
    run(sim, 360);
    expect(R.stats.greets).toBeGreaterThan(15);
    expect(R.stats.chats).toBeGreaterThan(5);
    for (const c of sim.entities.list) {
      const row = R['bonds'].get(c.pid);
      if (row) expect(row.size).toBeLessThanOrEqual(RELATIONS.bond.max);
      const m = R.mood(c);
      expect(m).toBeGreaterThanOrEqual(-100);
      expect(m).toBeLessThanOrEqual(100);
    }
    expect(JSON.stringify(R.serialize()).length).toBeLessThan(250_000);
  });
});
