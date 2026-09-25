import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
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

describe('ГО: проверка, арест, КПЗ', () => {
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
    expect(cell.occupant).toBe(t);
    expect(cell.door?.locked).toBe(true);
    expect(sim.log.some((l) => l.includes('задержал'))).toBe(true);
    console.log(`в камере через ${jailedAt.toFixed(1)} с`);
    run(sim, 80, () => t.law.phase === 'none');
    expect(t.law.phase).toBe('none');
    expect(t.brain).toBeInstanceOf(CitizenBrain);
    expect(cell.occupant).toBeNull();
    expect(t.law.wanted).toBe(false);
  });

  test('беглец: ГО гонится и либо задерживает, либо объявляет в розыск', { timeout: 60_000 }, () => {
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
    expect(count('citizen')).toBe(20);
    // 6 патрульных + на каждом из двух КПП 3 часовых GRID и медик HELIX.
    expect(count('cp')).toBe(14);
    const divisions = new Set(sim.entities.list.filter((c) => c.faction === 'cp').map((c) => c.division));
    for (const d of ['union', 'grid', 'helix', 'jury']) expect(divisions.has(d as never)).toBe(true);
    expect(count('rebel')).toBe(3);
    expect(count('admin')).toBe(1);
    // «Застрял»: одна и та же фаза процедуры (приказ, проверка, конвой, заведение) дольше 60 с.
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
          else worstStuck = Math.max(worstStuck, (t - s[0]) / 60);
        } else stuckSince.delete(c);
      }
    }
    const checks = sim.log.filter((l) => /оштрафовал|задержал|убегает|помещён/.test(l));
    console.log(`событий закона: ${checks.length}\n` + sim.log.slice(-12).join('\n'));
    console.log(`максимум в одной фазе процедуры: ${worstStuck.toFixed(1)} с`);
    expect(checks.length).toBeGreaterThan(0);
    expect(worstStuck).toBeLessThan(60);
    for (const cell of sim.law.cells) if (cell.occupant) expect(cell.occupant.law.phase).toBe('jailed');
  });
});
