import { ROSTER } from '../src/config/roster';
import { PRISON } from '../src/config/prison';
import { ACADEMY } from '../src/config/academy';
import { ARSENAL } from '../src/config/arsenal';
import { AI } from '../src/config/ai';
import { LAW } from '../src/config/law';
import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { belongsInPrison, chargeOf, wantedLevel } from '../src/systems/LawSystem';
import { spawnPopulation } from '../src/systems/Population';
import { lineOfSight } from '../src/world/visibility';
import { T } from '../src/world/tiles';
import type { Character } from '../src/entities/Character';

/** Два проходимых якоря на расстоянии ~d px с прямой видимостью (в переулке). */
function pairInSight(sim: ReturnType<typeof makeSim>, d: number): [number, number] {
  const { nav, map, ctx } = sim;
  for (let k = 0; k < 5000; k++) {
    const a = ctx.rng.pick(nav.walkable);
    const zone = map.zoneAtTile(nav.ax(a) + 1, nav.ay(a) + 1)?.kind;
    if (zone !== 'residential') continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const n = Math.round(d / nav.ts);
      const bx = nav.ax(a) + dx * n;
      const by = nav.ay(a) + dy * n;
      if (!nav.isWalkable(bx, by)) continue;
      const b = by * nav.w + bx;
      if (lineOfSight(map, nav.worldX(a), nav.worldY(a), nav.worldX(b), nav.worldY(b))) return [a, b];
    }
  }
  throw new Error('нет пары точек');
}

function run(sim: ReturnType<typeof makeSim>, seconds: number, until?: () => boolean): number {
  for (let t = 0; t < seconds * 60; t++) {
    sim.step();
    if (until?.()) return t / 60;
  }
  return seconds;
}

describe('видимость и двери', () => {
  const sim = makeSim(12345);
  const { map, doors, entities, nav } = sim;

  test('стены перекрывают обзор, открытая дверь — нет, закрытая — да', () => {
    const g = doors.groups.find((d) => d.tiles.length >= 2)!;
    const ts = map.tileSize;
    // Две точки по разные стороны двери поперёк неё.
    const t0 = g.tiles[0];
    const x = t0 % map.width;
    const y = (t0 - x) / map.width;
    const horizontal = map.tileAt(x + 1, y) === T.DOOR || map.tileAt(x - 1, y) === T.DOOR;
    const [ax, ay, bx, by] = horizontal
      ? [(x + 0.5) * ts, (y - 1.5) * ts, (x + 0.5) * ts, (y + 2.5) * ts]
      : [(x - 1.5) * ts, (y + 0.5) * ts, (x + 2.5) * ts, (y + 0.5) * ts];
    expect(g.closed).toBe(true);
    expect(lineOfSight(map, ax, ay, bx, by)).toBe(false);
    const c = createCharacter(entities, sim.ctx.rng, 'citizen', g.x, g.y);
    entities.rebuildHash();
    doors.update(entities, 0.2);
    expect(g.closed).toBe(false);
    expect(lineOfSight(map, ax, ay, bx, by)).toBe(true);
    entities.remove(c);
    entities.rebuildHash();
    for (let k = 0; k < 20; k++) doors.update(entities, 0.1);
    expect(g.closed).toBe(true);
  });

  test('запертая дверь непроходима для поиска пути', () => {
    const g = doors.groups[0];
    const a = nav.nearestWalkable(g.x, g.y, 1);
    doors.setLocked(g, true);
    expect(nav.nearestWalkable(g.x, g.y, 0)).toBe(-1);
    doors.setLocked(g, false);
    expect(nav.nearestWalkable(g.x, g.y, 1)).toBe(a);
  });
});

describe('ВС: проверка, арест, КПЗ', () => {
  test('проверка CID разыскиваемого → арест → конвой → камера → отпущен после срока', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const { entities, ctx, law, nav } = sim;
    const [a, b] = pairInSight(sim, 40);
    const cp = createCharacter(entities, ctx.rng, 'cp', nav.worldX(a), nav.worldY(a));
    const brain = new CpBrain(cp, ctx);
    cp.brain = brain;
    const t = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(b), nav.worldY(b));
    t.brain = new CitizenBrain(t, ctx);
    t.law.wanted = true;
    brain.target = t;
    t.law.handler = cp;
    law.beginCheck(cp, t);
    brain.fsm.change('check');
    const jailedAt = run(sim, 150, () => t.law.phase === 'jailed');
    expect(t.law.phase).toBe('jailed');
    const cell = law.cells[t.law.cell];
    // Гражданина сажают в общую камеру.
    expect(cell.common).toBe(true);
    expect(law.occupants(cell)).toContain(t);
    expect(cell.door?.locked).toBe(true);
    expect(sim.log.some((l) => l.includes('задержал'))).toBe(true);
    console.log(`в камере через ${jailedAt.toFixed(1)} с`);
    run(sim, 80, () => t.law.phase === 'none');
    expect(t.law.phase).toBe('none');
    expect(t.brain).toBeInstanceOf(CitizenBrain);
    expect(law.occupants(cell)).not.toContain(t);
    expect(t.law.wanted).toBe(false);
  });

  test('розыск по статьям: тяжесть, опознание в лицо по степени, срок ориентировки, беглый — бессрочно', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const { entities, ctx, law, nav } = sim;
    const C = LAW.wanted.charges;
    const [a, b] = pairInSight(sim, 80);
    const cp = createCharacter(entities, ctx.rng, 'cp', nav.worldX(a), nav.worldY(a));
    cp.brain = new CpBrain(cp, ctx);
    // ВС смотрит на него: опознание — в угле обзора.
    cp.facing = Math.atan2(nav.worldY(b) - cp.y, nav.worldX(b) - cp.x);
    const t = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(b), nav.worldY(b));
    t.brain = new CitizenBrain(t, ctx);
    t.law.wanted = false;
    law.declare(t, 'flight');
    expect(wantedLevel(t)).toBe(1);
    // 80 px — ближе, чем узнают по мелкой статье (face[0]).
    expect(law.observe(cp, t)).toBe('wanted');
    // В личине (подпольщик) — не узнаёт.
    t.disguised = true;
    expect(law.observe(cp, t)).toBeNull();
    t.disguised = false;
    // Статья тяжелее — заменяет прежнюю; легче — нет.
    law.declare(t, 'murder');
    expect(chargeOf(t)).toBe('murder');
    law.declare(t, 'theft');
    expect(chargeOf(t)).toBe('murder');
    // По особо тяжкой узнают дальше, чем по мелкой.
    const mid = (LAW.wanted.face[0] + LAW.wanted.face[2]) / 2;
    const m = createCharacter(entities, ctx.rng, 'citizen', cp.x + Math.cos(cp.facing) * mid, cp.y + Math.sin(cp.facing) * mid);
    m.law.wanted = false;
    law.declare(m, 'theft');
    const see = (o: Character) => (law as unknown as { canSee(a: Character, b: Character): boolean }).canSee(cp, o);
    if (see(m)) {
      expect(law.observe(cp, m)).not.toBe('wanted');
      law.declare(m, 'murder');
      expect(law.observe(cp, m)).toBe('wanted');
    }
    // Срок: мелкое снимают через term, особо тяжкое при враге Протектората (hostile) не истекает; беглый — бессрочно.
    entities.remove(cp);
    const small = createCharacter(entities, ctx.rng, 'citizen', t.x, t.y);
    small.law.wanted = false;
    law.declare(small, 'flight');
    const fug = createCharacter(entities, ctx.rng, 'citizen', t.x, t.y);
    fug.law.wanted = false;
    law.declare(fug, 'fugitive');
    t.hostile = true;
    run(sim, C.flight.term + 2);
    expect(small.law.wanted).toBe(false);
    expect(t.law.wanted).toBe(true);
    expect(fug.law.wanted).toBe(true);
    expect(law.wantedLeft(fug)).toBe(Infinity);
    t.hostile = false;
    expect(law.wantedLeft(t)).toBeGreaterThan(C.murder.term - 5);
  });

  test('срок заключения по статье: мелкое — КПЗ, тяжкое — тюрьма на срок (не навсегда), повинная — вдвое меньше', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const { entities, ctx, law } = sim;
    const C = LAW.wanted.charges;
    const term = (c: Character, prison: boolean) => (law as unknown as { jailTerm(c: Character, p: boolean): number }).jailTerm(c, prison);
    const c = createCharacter(entities, ctx.rng, 'citizen', 0, 0);
    c.law.wanted = false;
    law.declare(c, 'theft');
    expect(belongsInPrison(c)).toBe(false);
    expect(term(c, false)).toBe(C.theft.jail);
    law.declare(c, 'assault');
    expect(belongsInPrison(c)).toBe(true);
    expect(term(c, true)).toBe(C.assault.jail);
    c.law.surrendered = true;
    expect(term(c, true)).toBe(C.assault.jail * LAW.wanted.surrender.jailMul);
    // Повстанца-NPC держат бессрочно (вызволяют штурмом).
    const r = createCharacter(entities, ctx.rng, 'rebel', 0, 0);
    expect(term(r, true)).toBe(Infinity);
    // Отпущенный по сроку из тюрьмы — снова чист.
    law.pardon(c);
    expect(c.law.wanted).toBe(false);
    expect(c.law.wantedFor).toBeUndefined();
  });

  test('прохожий узнаёт разыскиваемого по тяжкой статье и зовёт ВС; по мелкой — нет', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const { entities, ctx, law, nav } = sim;
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const [a, b] = pairInSight(sim, 90);
    // Разыскиваемый стоит, лояльный прохожий смотрит на него, ВС рядом с прохожим — спиной к разыскиваемому.
    const t = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(a), nav.worldY(a));
    t.brain = null;
    t.law.wanted = false;
    law.declare(t, 'theft');
    const w = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(b), nav.worldY(b));
    w.brain = new CitizenBrain(w, ctx);
    w.loyalty = 60;
    w.law.wanted = false;
    w.facing = Math.atan2(t.y - w.y, t.x - w.x);
    const cpAt = nav.nearestWalkable(w.x + (w.x - t.x) * 0.6, w.y + (w.y - t.y) * 0.6, 3);
    const cp = createCharacter(entities, ctx.rng, 'cp', nav.worldX(cpAt), nav.worldY(cpAt));
    cp.brain = new CpBrain(cp, ctx);
    cp.law.wanted = false;
    cp.facing = Math.atan2(cp.y - t.y, cp.x - t.x);
    // Прохожий и ВС стоят на своих местах (у прохожего свои дела — увёл бы его), пока не позвали.
    const wp = { x: w.x, y: w.y };
    const cpp = { x: cp.x, y: cp.y, f: cp.facing };
    const keep = () => {
      if (sim.ctx.senses.stats.informed > 0) return false;
      w.x = w.prevX = wp.x;
      w.y = w.prevY = wp.y;
      w.facing = Math.atan2(t.y - w.y, t.x - w.x);
      cp.x = cp.prevX = cpp.x;
      cp.y = cp.prevY = cpp.y;
      cp.facing = cpp.f;
      return false;
    };
    run(sim, 6, keep);
    expect(sim.ctx.senses.stats.informed).toBe(0);
    law.declare(t, 'murder');
    run(sim, 20, () => keep() || sim.ctx.senses.stats.informed > 0);
    expect(sim.ctx.senses.stats.informed).toBeGreaterThanOrEqual(1);
    expect(t.law.phase === 'ordered' || t.law.phase === 'checking' || t.law.phase === 'cuffed' || (cp.brain as CpBrain).target === t).toBe(true);
  });

  test('беглец: ВС гонится и либо задерживает, либо объявляет в розыск', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const { entities, ctx, law, nav } = sim;
    const [a, b] = pairInSight(sim, 96);
    const cp = createCharacter(entities, ctx.rng, 'cp', nav.worldX(a), nav.worldY(a));
    const brain = new CpBrain(cp, ctx);
    cp.brain = brain;
    const t = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(b), nav.worldY(b));
    t.brain = new CitizenBrain(t, ctx);
    t.law.wanted = false;
    brain.engage(t, 'running');
    if (t.law.phase !== 'fleeing') law.startFlee(t);
    brain.fsm.change('chase');
    run(sim, 60, () => t.law.phase !== 'fleeing');
    expect(['cuffed', 'entering', 'jailed', 'none']).toContain(t.law.phase);
    if (t.law.phase === 'none') expect(t.law.wanted).toBe(true);
  });

  test('игрок, которому приказали стоять, но он ушёл, — «в бегах»', () => {
    const sim = makeSim(12345);
    const { entities, ctx, law, nav } = sim;
    const [a, b] = pairInSight(sim, 60);
    const cp = createCharacter(entities, ctx.rng, 'cp', nav.worldX(a), nav.worldY(a));
    const p = createCharacter(entities, ctx.rng, 'citizen', nav.worldX(b), nav.worldY(b), true);
    law.order(cp, p, 'running');
    expect(p.law.phase).toBe('ordered');
    law.update(1, p);
    p.x += 60;
    law.update(0.1, p);
    expect(p.law.phase).toBe('fleeing');
  });
});

describe('живой город со всеми фракциями', () => {
  test('3 минуты: проверки и задержания идут, никто не зависает', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const count = (f: string) => sim.entities.list.filter((c) => c.faction === f).length;
    // 20 граждан + барыга + бойцы и авторитеты банд.
    const gangsters = sim.entities.list.filter((c) => c.gang >= 0).length;
    expect(gangsters).toBeGreaterThanOrEqual(10);
    expect(count('citizen')).toBe(21 + gangsters);
    // Силовой блок города (ROSTER.cp) + на каждом из двух КПП 5 спецназовцев SU.03 (2 во внешней
    // точке, 3 во внутренней), 2 RCT.PCU в проходной и медик SU.02; склад — кладовщик, охрана и экипаж конвоя;
    // тюрьма — охрана и начальник.
    const C = ROSTER.cp;
    const city = C.nexusPosts + C.publicPosts + C.squads * (1 + C.squadFollowers) + C.investigators + C.technicians + C.officers + C.inspectors + C.guards + C.epu;
    const depot = sim.arsenal.present ? 1 + ARSENAL.guards + ARSENAL.convoy.crew : 0;
    // Тюрьма Протектората — охрана SU.GUARD и начальник (третий SU.INSP).
    const prison = sim.ctx.prison.present ? PRISON.guards + 1 : 0;
    // Академия ВС — вахтёры RCT и инструкторы.
    const academy = sim.academy.present ? ACADEMY.vakhta + ACADEMY.instructors : 0;
    // Блок-посты стены Верхнего города (RCT и дежурные SU.03) и ворота ГЭС — по человеку на место.
    const border = sim.map.poisOf('border_post').length + sim.map.poisOf('border_duty').length + sim.map.poisOf('ges_post').length;
    expect(count('cp')).toBe(city + 2 * (5 + 2 + 1) + depot + prison + academy + border);
    const divisions = new Set(sim.entities.list.filter((c) => c.faction === 'cp').map((c) => c.division));
    for (const d of ['pcu', 'su', 'cmd']) expect(divisions.has(d as never)).toBe(true);
    // Армия в лагере + HYDRA + подпольщики и спецагент в схроне.
    const army = [...ROSTER.army, ...ROSTER.hydra].reduce((n, [, k]) => n + k, 0);
    expect(count('rebel')).toBe(AI.population.rebels + ROSTER.partisans + ROSTER.agents + army);
    expect(count('admin')).toBe(1);
    // «Застрял»: одна и та же фаза процедуры (приказ, проверка, заведение) дольше 60 с, конвой — дольше 100 с (большая карта:
    // от Верхнего города до тюрьмы с приёмкой).
    const stuckSince = new Map<Character, [number, string]>();
    let worstStuck = 0;
    for (let t = 0; t < 180 * 60; t++) {
      sim.step();
      if (t % 30 !== 0) continue;
      for (const c of sim.entities.list) {
        const ph = c.law.phase;
        if (ph === 'ordered' || ph === 'checking' || ph === 'cuffed' || ph === 'entering') {
          const s = stuckSince.get(c);
          if (!s || s[1] !== ph) stuckSince.set(c, [t, ph]);
          // Конвой через весь город к КПЗ идёт дольше остальных фаз — ему запас побольше.
          else worstStuck = Math.max(worstStuck, ((t - s[0]) / 60) * (ph === 'cuffed' ? 0.6 : 1));
        } else stuckSince.delete(c);
      }
    }
    const checks = sim.log.filter((l) => /оштрафовал|задержал|убегает|помещён/.test(l));
    console.log(`событий закона: ${checks.length}\n` + sim.log.slice(-12).join('\n'));
    console.log(`максимум в одной фазе процедуры: ${worstStuck.toFixed(1)} с`);
    expect(checks.length).toBeGreaterThan(0);
    expect(worstStuck).toBeLessThan(60);
    for (const cell of sim.law.cells) for (const o of sim.law.occupants(cell)) expect(o.law.phase).toBe('jailed');
  });
});
