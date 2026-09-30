import { randomAnchorAround } from '../src/ai/destinations';
import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation, settleAll } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { UndergroundBrain } from '../src/ai/brains/UndergroundBrain';
import { GangOpBrain } from '../src/ai/brains/GangOpBrain';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { GANGS } from '../src/config/gangs';
import { ECONOMY } from '../src/config/economy';
import type { Inventory } from '../src/entities/Inventory';
import { CP_UNIT } from '../src/config/factions';
import { lineOfSight } from '../src/world/visibility';
import type { Character } from '../src/entities/Character';

const setup = (npcs = 40) => {
  const sim = makeSim(12345);
  sim.war.command.paused = true;
  spawnPopulation(sim.ctx, npcs);
  return sim;
};

describe('банды', () => {
  test('две-три банды: авторитет и 4–5 бойцов, своя общага с общаком и свой район', { timeout: 60_000 }, () => {
    const sim = setup();
    const G = sim.ctx.gangs;
    expect(G.gangs.length).toBeGreaterThanOrEqual(2);
    expect(G.gangs.length).toBeLessThanOrEqual(3);
    const quarters = new Set<string>();
    for (const g of G.gangs) {
      const m = G.members(g);
      expect(m.filter((c) => c.profession === 'gang_boss')).toHaveLength(1);
      const n = m.filter((c) => c.profession === 'bandit').length;
      expect(n).toBeGreaterThanOrEqual(GANGS.members[0]);
      expect(n).toBeLessThanOrEqual(GANGS.members[1]);
      // Живут в своей общаге (комнаты — только для банды), авторитет — у общака.
      for (const c of m) expect(g.rooms.map((r) => r.id)).toContain(c.home);
      expect(g.rooms.every((r) => r.reserved)).toBe(true);
      expect(Math.hypot(G.boss(g)!.x - g.hq.x, G.boss(g)!.y - g.hq.y)).toBeLessThan(40);
      expect(g.turf.size).toBeGreaterThanOrEqual(2);
      expect(g.anchors.length).toBeGreaterThan(100);
      quarters.add(g.quarter);
    }
    // Районы разные.
    expect(quarters.size).toBe(G.gangs.length);
    // Общаги банд не отданы горожанам.
    const other = sim.entities.list.filter((c) => c.gang < 0 && c.home >= 0 && c.role?.kind !== 'trader');
    for (const c of other) expect(sim.ctx.housing.of(c)!.reserved).toBe(false);
  });

  test('бойцы разных банд, увидев друг друга, — стычка: стреляют друг в друга', { timeout: 60_000 }, () => {
    const sim = setup();
    const G = sim.ctx.gangs;
    const [ga, gb] = G.gangs;
    const a = G.members(ga).find((c) => c.profession === 'bandit')!;
    const b = G.members(gb).find((c) => c.profession === 'bandit')!;
    // Сводим их в пределах видимости в районе первой банды.
    const spot = ga.anchors.find((an) => {
      const x = sim.nav.worldX(an);
      const y = sim.nav.worldY(an);
      const k = sim.nav.nearestWalkable(x + 90, y, 1);
      return k >= 0 && lineOfSight(sim.map, x, y, sim.nav.worldX(k), sim.nav.worldY(k));
    })!;
    const place = (c: Character, x: number, y: number) => {
      c.x = c.prevX = x;
      c.y = c.prevY = y;
    };
    const x = sim.nav.worldX(spot);
    const y = sim.nav.worldY(spot);
    const k = sim.nav.nearestWalkable(x + 90, y, 1);
    place(a, x, y);
    place(b, sim.nav.worldX(k), sim.nav.worldY(k));
    sim.entities.rebuildHash();
    const shots = sim.combat.shotsFired;
    for (let t = 0; t < 20 * 60 && sim.combat.shotsFired === shots; t++) sim.step();
    expect(G.stats.feuds).toBeGreaterThan(0);
    expect(G.feuding(ga.id, gb.id)).toBe(true);
    expect(sim.ctx.combat.isHostile(a, b)).toBe(true);
    expect(sim.combat.shotsFired).toBeGreaterThan(shots);
    expect(sim.log.some((l) => l.includes('Стычка банд'))).toBe(true);
  });

  test('дела: дань с лавки — в общак, ствол у барыги — в общак', { timeout: 120_000 }, () => {
    const sim = setup();
    // Без ГО: проверка CID по дороге (ведомый побежал — арестован, дело сорвано) — дело случая.
    for (const c of sim.entities.list.filter((o) => o.faction === 'cp')) sim.entities.remove(c);
    const G = sim.ctx.gangs;
    G.paused = true;
    const g = G.gangs[0];
    // И без чужих банд: стычка по дороге к барыге (ранили — дело сорвано) — тоже дело случая.
    for (const o of G.gangs) if (o !== g) for (const c of G.members(o)) sim.entities.remove(c);
    const bank = g.bank;
    const op = G.startOp(g, 'racket')!;
    expect(op).not.toBeNull();
    expect(op.team.every((c) => c.brain instanceof GangOpBrain)).toBe(true);
    for (let t = 0; t < 150 * 60 && !op.done; t++) sim.step();
    expect(op.done).toBe(true);
    expect(g.bank).toBeGreaterThan(bank);
    expect(g.stats.racket).toBe(1);
    for (let t = 0; t < 5 * 60 && g.op; t++) sim.step();
    // Покупка ствола у барыги.
    const F = sim.ctx.fence;
    expect(F.present && F.open).toBe(true);
    g.bank = 500;
    const guns = g.stash.slots.filter((s) => GANGS.arms.includes(s.id as never)).reduce((n, s) => n + s.qty, 0);
    const buy = G.startOp(g, 'buy')!;
    for (let t = 0; t < 200 * 60 && !buy.done; t++) sim.step();
    expect(buy.done).toBe(true);
    expect(g.stats.buys).toBe(1);
    expect(F.stats.gangBuys).toBe(1);
    expect(g.stash.slots.filter((s) => GANGS.arms.includes(s.id as never)).reduce((n, s) => n + s.qty, 0)).toBe(guns + 1);
  });

  test('удар по ГО: бойцы достают стволы у патрульного, враги Альянса, в розыске', { timeout: 120_000 }, () => {
    const sim = setup(20);
    const G = sim.ctx.gangs;
    G.paused = true;
    const g = G.gangs[0];
    // Патрульный — в районе банды.
    const an = g.anchors[Math.floor(g.anchors.length / 2)];
    const cp = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, { x: sim.nav.worldX(an), y: sim.nav.worldY(an) })!;
    const op = G.startOp(g, 'hit')!;
    expect(op.kind).toBe('hit');
    // Проверку CID команда только что прошла (иначе плановая проверка по дороге — бегство и арест).
    for (const c of op.team) {
      c.law.lastCheck = sim.law.now;
      c.law.wanted = false;
      c.law.hasCid = true;
    }
    // Патрульный — рядом с командой (по дороге через район их может остановить другой патруль).
    const near = randomAnchorAround(op.team[0], sim.ctx, 8, 12, new Set());
    if (near >= 0) {
      cp.x = cp.prevX = sim.nav.worldX(near);
      cp.y = cp.prevY = sim.nav.worldY(near);
    }
    let attacked = false;
    for (let t = 0; t < 120 * 60 && !attacked; t++) {
      sim.step();
      attacked = op.team.some((c) => c.hostile);
    }
    expect(attacked).toBe(true);
    expect(op.team.some((c) => c.law.wanted)).toBe(true);
    expect(sim.log.some((l) => l.includes('нападение на патруль'))).toBe(true);
  });
});

describe('барыга — вся связь подполья с улицей', () => {
  test('хата у запретной зоны; партизан сдаёт краденое с явки, заказ — банде удар по ГО', { timeout: 200_000 }, () => {
    // Без патрулей (проверка CID по дороге — дело случая): подполье, барыга, банды, дома.
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.insurgency.populate();
    sim.ctx.gangs.populate();
    settleAll(sim.ctx);
    sim.insurgency.paused = true;
    sim.ctx.gangs.paused = true;
    const F = sim.ctx.fence;
    expect(F.present).toBe(true);
    expect(F.trader?.alive).toBe(true);
    expect(sim.ctx.housing.of(F.trader!)).toBe(F.home);
    expect(F.home!.reserved).toBe(true);
    // Хата — ближе всех к воротам запретной зоны, но не в ней.
    const gate = sim.map.poisOf('restricted_gate')[0];
    expect(sim.map.zoneAtWorld(F.counter!.x, F.counter!.y)?.kind).not.toBe('restricted');
    expect(Math.hypot(F.counter!.x - (gate.x + 0.5) * 16, F.counter!.y - (gate.y + 0.5) * 16)).toBeLessThan(900);
    // Чёрный рынок — у барыги: стволы только принесённые.
    expect(sim.insurgency.market).toEqual(F.counter);
    // Партизан: краденое на явке → барыге.
    const p = sim.insurgency.garrison.find((c) => c.brain instanceof UndergroundBrain)!;
    const stash = sim.ctx.housing.stashOf(p)!;
    stash.add('mp7', 2);
    stash.add('grenade', 3);
    sim.insurgency.funds = 200;
    const wares = F.wares.count('mp7');
    const op = sim.insurgency.startOperation('fence')!;
    expect(op.kind).toBe('fence');
    const before = F.stats.boughtIn;
    for (let t = 0; t < 180 * 60 && F.stats.boughtIn === before; t++) sim.step();
    console.log(`барыга: ${JSON.stringify(F.stats)}, товар ${JSON.stringify(F.wares.slots)}, выручка подполья ${sim.insurgency.funds}, заказов ${F.orders}`);
    expect(F.wares.count('mp7')).toBe(wares + 2);
    expect(stash.slots).toHaveLength(0);
    expect(sim.insurgency.stats.fenced).toBe(5);
    // Заказ подполья → банда идёт бить ГО (оплачено).
    F.orders = Math.max(F.orders, 1);
    sim.ctx.gangs.paused = false;
    const g = sim.ctx.gangs.gangs[0];
    g.nextOp = 0;
    for (let t = 0; t < 5 * 60 && !g.op; t++) sim.step();
    expect(g.op?.kind).toBe('hit');
    expect(g.op?.paid).toBe(true);
  });
});

describe('по одному — только на районе, в городе — парами', () => {
  test('3 минуты: вне района рядом всегда свой; выходы в город — вдвоём, дела — не меньше двоих', { timeout: 300_000 }, () => {
    const sim = setup(50);
    const G = sim.ctx.gangs;
    const jailed = new Set<number>();
    let samples = 0;
    let solo = 0;
    let trips = 0;
    const teams: number[] = [];
    for (let t = 0; t < 180 * 60; t++) {
      sim.step();
      for (const g of G.gangs) if (g.op && !teams.includes(g.op.team.length * 1000 + g.id)) teams.push(g.op.team.length * 1000 + g.id);
      if (t % 30) continue;
      for (const c of sim.entities.list) {
        // Тяжелораненый лежит (стычка) — он не «гуляет один».
        if (c.gang < 0 || c.isPlayer || !c.fit || sim.map.levelAt(c.x, c.y) !== 'city') continue;
        // Задержанных ведёт ГО, отпущенный из КПЗ идёт на район сам — это не прогулка.
        if (c.brain?.constructor.name === 'PrisonerBrain') jailed.add(c.id);
        if (jailed.has(c.id)) continue;
        samples++;
        if (c.brain instanceof CitizenBrain && c.brain.escort.length) trips++;
        const g = G.of(c)!;
        if (G.inTurf(g, c.x, c.y)) continue;
        const mate = sim.entities.list.some((o) => o !== c && o.alive && o.gang === c.gang && Math.hypot(o.x - c.x, o.y - c.y) < 160);
        if (!mate) solo++;
      }
    }
    console.log(`пары банд: замеров ${samples}, один вне района ${solo}, ведут напарника ${trips}, дела (состав) ${teams.map((k) => Math.floor(k / 1000)).join(',')}`);
    expect(trips).toBeGreaterThan(0);
    expect(solo / samples).toBeLessThan(0.05);
    // Дела — не меньше двоих.
    expect(teams.every((k) => Math.floor(k / 1000) >= GANGS.pairs.min)).toBe(true);
  });
});

describe('товар барыге', () => {
  test('подполье без товара — за стволами на склад, с явки — барыге (виден в продаже); банда сбывает лишнее', { timeout: 300_000 }, () => {
    // Без патрулей и охраны склада (задержание по дороге — дело случая).
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.insurgency.populate();
    sim.ctx.gangs.populate();
    settleAll(sim.ctx);
    sim.insurgency.paused = true;
    sim.ctx.gangs.paused = true;
    // Одна банда: стычка банд, пока подполье носит краденое, ранит будущих продавцов — дело случая.
    for (const o of sim.ctx.gangs.gangs.slice(1)) for (const c of sim.ctx.gangs.members(o)) sim.entities.remove(c);
    const I = sim.insurgency;
    const F = sim.ctx.fence;
    const ALLIANCE = ['mp7', 'usp', 'm4a4'] as const;
    const guns = (inv: Inventory) => ALLIANCE.reduce((n, id) => n + inv.count(id), 0);
    // Нести барыге нечего — к нему не ходят, а идут за добычей: стволы со стоек склада.
    expect(I.goodsStash()).toBeNull();
    const op = I.startOperation('depot')!;
    expect(op.kind).toBe('depot');
    const stash = sim.ctx.housing.stashOf(op.team[0])!;
    for (let t = 0; t < 240 * 60 && guns(stash) === 0; t++) sim.step();
    expect(guns(stash)).toBeGreaterThan(0);
    expect(I.goodsStash()).not.toBeNull();
    for (let t = 0; t < 240 * 60 && I.ops.includes(op); t++) sim.step();
    // Товар есть — к барыге: краденый ствол Альянса у него в продаже.
    const before = guns(F.wares);
    const deal = I.startOperation('fence')!;
    expect(deal.kind).toBe('fence');
    for (let t = 0; t < 300 * 60 && guns(F.wares) === before; t++) sim.step();
    expect(guns(F.wares)).toBeGreaterThan(before);
    expect(I.goodsStash()).toBeNull();
    const k = ECONOMY.blackMarket.stock.findIndex((s) => (ALLIANCE as readonly string[]).includes(s.id) && F.wares.has(s.id));
    expect(k).toBeGreaterThanOrEqual(0);
    expect(F.inStock(k)).toBe(true);
    // Банда: лишние стволы из общака (сверх запаса) — барыге за деньги.
    const G = sim.ctx.gangs;
    const g = G.gangs[0];
    g.stash.add('mp7', 2);
    g.stash.add('usp', 1);
    expect(G.surplus(g).length).toBeGreaterThan(0);
    const bank = g.bank;
    const wares = F.stats.boughtIn;
    const sell = G.startOp(g, 'sell')!;
    expect(sell.team.length).toBeGreaterThanOrEqual(GANGS.pairs.min);
    for (let t = 0; t < 200 * 60 && !sell.done; t++) sim.step();
    expect(g.stats.sells).toBe(1);
    expect(g.bank).toBeGreaterThan(bank);
    expect(F.stats.boughtIn).toBeGreaterThan(wares);
    expect(G.stashGuns(g)).toBe(GANGS.ops.sell.keep);
  });
});

describe('город с бандами', () => {
  test('5 минут: банды ходят на дела (дань, налёты, удары), стычки на районах', { timeout: 400_000 }, () => {
    const sim = setup(50);
    const G = sim.ctx.gangs;
    for (let t = 0; t < 300 * 60; t++) sim.step();
    const s = G.gangs.map((g) => `${g.def.name}: ${JSON.stringify(g.stats)} общак ${g.bank}`);
    console.log(`банды: дел ${G.stats.ops}, стычек ${G.stats.feuds}; ${s.join(' | ')}`);
    expect(G.stats.ops).toBeGreaterThanOrEqual(3);
    expect(G.gangs.reduce((n, g) => n + g.stats.racket + g.stats.raids + g.stats.hits + g.stats.buys + g.stats.convoys, 0)).toBeGreaterThan(0);
  });
});
