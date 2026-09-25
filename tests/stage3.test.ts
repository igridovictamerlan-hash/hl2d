import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { spawnPopulation, equipKit } from '../src/systems/Population';
import { lineOfSight } from '../src/world/visibility';
import { ECONOMY } from '../src/config/economy';
import { WAR } from '../src/config/war';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): number {
  for (let t = 0; t < seconds * 60; t++) {
    sim.step();
    if (until?.()) return t / 60;
  }
  return seconds;
}

/** Две проходимые точки в жилом квартале на расстоянии ~d с прямой видимостью. */
function pairInSight(sim: Sim, d: number): [number, number] {
  const { nav, map, ctx } = sim;
  for (let k = 0; k < 5000; k++) {
    const a = ctx.rng.pick(nav.walkable);
    if (map.zoneAtTile(nav.ax(a) + 1, nav.ay(a) + 1)?.kind !== 'residential') continue;
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

describe('экономика', () => {
  test('раздача рационов: очередь, ГСР выдаёт, граждане получают паёк и токены', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const before = new Map(sim.entities.list.map((c) => [c, c.money]));
    run(sim, ECONOMY.rations.firstDelay + ECONOMY.rations.duration - 1);
    const served = sim.entities.list.filter((c) => sim.economy.hasBeenServed(c));
    console.log(`получили рацион: ${served.length}, работник: ${sim.economy.dispenser?.name ?? '—'}`);
    expect(served.length).toBeGreaterThanOrEqual(5);
    for (const c of served) {
      expect(c.money).toBeGreaterThanOrEqual((before.get(c) ?? 0) + ECONOMY.rations.tokens - 20);
    }
    expect(served.some((c) => c.inventory.has('ration') || c.hunger > 90)).toBe(true);
  });

  test('голод: сытость падает, при нуле — урон; NPC ест, если есть еда', () => {
    const sim = makeSim(12345);
    const a = sim.nav.walkable[100];
    const hungry = createCharacter(sim.entities, sim.ctx.rng, 'citizen', sim.nav.worldX(a), sim.nav.worldY(a), true);
    hungry.hunger = 0.5;
    const npc = createCharacter(sim.entities, sim.ctx.rng, 'citizen', sim.nav.worldX(a) + 40, sim.nav.worldY(a));
    npc.hunger = 10;
    npc.inventory.add('bread', 1);
    sim.economy.update(10);
    expect(hungry.hunger).toBe(0);
    expect(hungry.health).toBeLessThan(100);
    expect(npc.inventory.has('bread')).toBe(false);
    expect(npc.hunger).toBeGreaterThan(30);
  });

  test('магазин: покупка списывает токены, без денег — отказ', () => {
    const sim = makeSim(12345);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 100, 100);
    c.money = 10;
    expect(sim.economy.buy(c, 'bread')).toBeNull();
    expect(c.money).toBe(4);
    expect(c.inventory.has('bread')).toBe(true);
    expect(sim.economy.buy(c, 'medkit')).toMatch(/Не хватает/);
  });

  test('ГСР чинит поломку и получает оплату', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const spot = sim.economy.repairs[0];
    spot.broken = true;
    const a = sim.nav.nearestWalkable(spot.x, spot.y, 6);
    const w = createCharacter(sim.entities, sim.ctx.rng, 'cwu', sim.nav.worldX(a), sim.nav.worldY(a));
    equipKit(w, 'cwu', sim.ctx);
    w.brain = new CitizenBrain(w, sim.ctx);
    (w.brain as CitizenBrain).idleLeft = 0;
    const money = w.money;
    run(sim, 60, () => !spot.broken);
    expect(spot.broken).toBe(false);
    expect(w.money).toBeGreaterThan(money);
  });
});

describe('бой', () => {
  test('выстрел попадает в цель на линии огня, стена пулю останавливает, тело с лутом', () => {
    const sim = makeSim(12345);
    const [a, b] = pairInSight(sim, 96);
    const shooter = createCharacter(sim.entities, sim.ctx.rng, 'cp', sim.nav.worldX(a), sim.nav.worldY(a));
    equipKit(shooter, 'cp', sim.ctx);
    const target = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(b), sim.nav.worldY(b));
    equipKit(target, 'rebel_raider', sim.ctx);
    sim.entities.rebuildHash();
    let hits = 0;
    for (let k = 0; k < 40 && target.alive; k++) {
      sim.combat.update(0.5);
      if (sim.combat.fire(shooter, target.x, target.y) === target) hits++;
    }
    expect(hits).toBeGreaterThan(0);
    expect(target.alive).toBe(false);
    const corpse = sim.combat.corpseNear(target.x, target.y, 20)!;
    expect(corpse.loot.some((s) => s.id === 'rebel_pistol')).toBe(true);
    const looter = createCharacter(sim.entities, sim.ctx.rng, 'citizen', target.x, target.y);
    expect(sim.combat.loot(looter, corpse)).toBeGreaterThan(0);
    expect(looter.inventory.has('rebel_pistol')).toBe(true);
  });

  test('стена останавливает пулю: цель за домом не задета', () => {
    const sim = makeSim(12345);
    const { nav, map, ctx } = sim;
    // Пара точек рядом (≈80 px), между которыми стена.
    let pair: [number, number] | null = null;
    for (let k = 0; k < 5000 && !pair; k++) {
      const a = ctx.rng.pick(nav.walkable);
      const b = nav.nearestWalkable(nav.worldX(a) + 80, nav.worldY(a), 1);
      if (b >= 0 && !lineOfSight(map, nav.worldX(a), nav.worldY(a), nav.worldX(b), nav.worldY(b))) pair = [a, b];
    }
    const [a, b] = pair!;
    const shooter = createCharacter(sim.entities, ctx.rng, 'cp', nav.worldX(a), nav.worldY(a));
    equipKit(shooter, 'cp', ctx);
    const target = createCharacter(sim.entities, ctx.rng, 'rebel', nav.worldX(b), nav.worldY(b));
    sim.entities.rebuildHash();
    for (let k = 0; k < 30; k++) {
      sim.combat.update(0.5);
      expect(sim.combat.fire(shooter, target.x, target.y)).toBeNull();
    }
    expect(target.health).toBe(100);
    expect(sim.combat.stats.wall).toBeGreaterThan(0);
  });

  test('ГО реагирует на повстанцев: вооружённого — огнём, безоружного — задержанием', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const [a, b] = pairInSight(sim, 120);
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', sim.nav.worldX(a), sim.nav.worldY(a));
    equipKit(cp, 'cp', sim.ctx);
    cp.facing = Math.atan2(sim.nav.worldY(b) - cp.y, sim.nav.worldX(b) - cp.x);
    cp.brain = new CpBrain(cp, sim.ctx);
    const armed = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(b), sim.nav.worldY(b));
    equipKit(armed, 'rebel_raider', sim.ctx);
    run(sim, 10, () => sim.combat.shotsFired > 0);
    expect(sim.combat.shotsFired).toBeGreaterThan(0);

    const sim2 = makeSim(12345);
    const [c, d] = pairInSight(sim2, 80);
    const cp2 = createCharacter(sim2.entities, sim2.ctx.rng, 'cp', sim2.nav.worldX(c), sim2.nav.worldY(c));
    equipKit(cp2, 'cp', sim2.ctx);
    const face = Math.atan2(sim2.nav.worldY(d) - cp2.y, sim2.nav.worldX(d) - cp2.x);
    cp2.facing = face;
    const brain2 = new CpBrain(cp2, sim2.ctx);
    cp2.brain = brain2;
    // Стоит постом лицом к повстанцу.
    brain2.fsm.change('post');
    brain2.postFacing = face;
    const unarmed = createCharacter(sim2.entities, sim2.ctx.rng, 'rebel', sim2.nav.worldX(d), sim2.nav.worldY(d));
    run(sim2, 2, () => unarmed.law.phase !== 'none');
    expect(unarmed.law.phase).not.toBe('none');
    expect(sim2.combat.shotsFired).toBe(0);
  });
});

describe('война на границе', () => {
  test('у КПП идёт перестрелка, есть потери, ГО получает подкрепления', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    run(sim, 150);
    console.log(`выстрелов: ${sim.combat.shotsFired}, попаданий: ${sim.combat.hits}, убитых: ${sim.combat.kills}`);
    expect(sim.combat.shotsFired).toBeGreaterThan(200);
    expect(sim.combat.hits).toBeGreaterThan(20);
    for (const f of sim.war.fronts) expect(f.posts.length).toBe(2);
  });

  test('прорыв в город → красный код, комендантский час, OTA; зачистка → зелёный', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    run(sim, 30);
    // Отряд у западного КПП «прорывается»: переносим бойца за внутренние ворота.
    const f = sim.war.fronts[0];
    sim.war.forceAssault(0);
    const r = f.squad[0];
    const a = sim.nav.nearestWalkable(f.apron.x + (f.apron.x - f.outerGate.x) * 0.8, f.apron.y, 8);
    r.x = r.prevX = sim.nav.worldX(a);
    r.y = r.prevY = sim.nav.worldY(a);
    sim.step();
    expect(sim.war.code).toBe('red');
    expect(sim.war.curfew).toBe(true);
    expect(sim.war.ota.length).toBe(WAR.otaSquad);
    expect(sim.economy.open).toBe(false);
    // Граждане уходят в укрытия.
    run(sim, WAR.curfewGrace + 20);
    const civ = sim.entities.list.filter((c) => c.faction === 'citizen' && c.law.phase === 'none');
    const inside = civ.filter((c) => !sim.war.outdoors(c)).length;
    console.log(`граждан в укрытии: ${inside} из ${civ.length}`);
    expect(inside / Math.max(1, civ.length)).toBeGreaterThan(0.5);
    // Прорвавшихся ликвидируют или время тревоги выходит — отбой.
    run(sim, WAR.redMaxTime + 30, () => sim.war.code === 'green');
    expect(sim.war.code).toBe('green');
    expect(sim.war.curfew).toBe(false);
  });
});
