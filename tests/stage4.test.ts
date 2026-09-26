import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { generateCity } from '../src/world/generator/CityGenerator';
import { NavGrid } from '../src/world/NavGrid';
import { serializeMap, parseMap } from '../src/world/mapIO';
import { buildAnchorWalk, labelComponents } from '../src/world/connectivity';
import { createCharacter } from '../src/entities/factory';
import { spawnPopulation, equipKit, poiWorld } from '../src/systems/Population';
import { randomAnchorAround } from '../src/ai/destinations';
import { UndergroundBrain } from '../src/ai/brains/UndergroundBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { ECONOMY } from '../src/config/economy';
import { GENERATOR } from '../src/config/generator';
import { ALARM } from '../src/config/underground';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): number {
  for (let t = 0; t < seconds * 60; t++) {
    sim.step();
    if (until?.()) return t / 60;
  }
  return seconds;
}

describe('канализация', () => {
  for (const seed of [12345, 7919, 2024]) {
    test(`seed ${seed}: отдельная область справа, люки парами, всё связно`, () => {
      const map = generateCity(seed);
      const u = map.underground!;
      expect(u).not.toBeNull();
      expect(u.x * map.tileSize).toBeGreaterThanOrEqual(map.levelBounds('city').w);
      expect(map.hatches.length).toBeGreaterThanOrEqual(GENERATOR.sewers.hatches - 2);
      const kinds = new Set(map.zones.map((z) => z.kind));
      for (const k of ['sewer', 'rebel_base', 'black_market'] as const) expect(kinds.has(k)).toBe(true);
      const walk = buildAnchorWalk(map.tiles, map.width, map.height);
      const aw = map.width - 1;
      const { labels } = labelComponents(walk, aw, map.height - 1);
      const lab = (p: { x: number; y: number }) => labels[p.y * aw + p.x];
      const cityHatches = map.pois.filter((p) => p.type === 'hatch');
      const sewerHatches = map.pois.filter((p) => p.type === 'sewer_hatch');
      // Все люки города — в одной (городской) компоненте, все люки канализации — в другой, общей.
      const cityLabels = new Set(cityHatches.map(lab));
      const sewerLabels = new Set(sewerHatches.map(lab));
      expect(cityLabels.size).toBe(1);
      expect(sewerLabels.size).toBe(1);
      expect([...cityLabels][0]).toBeGreaterThanOrEqual(0);
      expect([...sewerLabels][0]).not.toBe([...cityLabels][0]);
      for (const h of map.hatches) {
        expect(map.levelAt(h.city.x, h.city.y)).toBe('city');
        expect(map.levelAt(h.sewer.x, h.sewer.y)).toBe('sewer');
      }
      // Убежище, тайник, рынок и торговец — в той же сети канализации.
      const nav = new NavGrid(map);
      const sewer = [...sewerLabels][0];
      for (const t of ['rebel_base', 'rebel_cache', 'black_market', 'trader'] as const) {
        const p = map.poisOf(t)[0];
        expect(p).toBeDefined();
        const a = nav.nearestWalkable((p.x + 0.5) * map.tileSize, (p.y + 0.5) * map.tileSize, 2);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(labels[a]).toBe(sewer);
      }
    });
  }

  test('JSON сохраняет люки и канализацию', () => {
    const map = generateCity(12345);
    const back = parseMap(serializeMap(map));
    expect(back.width).toBe(map.width);
    expect(back.underground).toEqual(map.underground);
    expect(back.hatches).toEqual(map.hatches);
  });

  test('пути между уровнями нет (только люки), цели прогулок — на своём уровне', () => {
    const sim = makeSim(12345);
    const { nav, ctx } = sim;
    const city = nav.walkable.find((i) => nav.level[i] === 0)!;
    const sewer = nav.walkable.find((i) => nav.level[i] === 1)!;
    const t0 = performance.now();
    expect(ctx.paths.findNow(nav.worldX(city), nav.worldY(city), sewer)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(20);
    const h = sim.map.hatches[0];
    for (let k = 0; k < 200; k++) {
      const a = randomAnchorAround(h.city, ctx, 5, 120, new Set());
      if (a >= 0) expect(nav.level[a]).toBe(0);
      const b = randomAnchorAround(h.sewer, ctx, 5, 120, new Set());
      if (b >= 0) expect(nav.level[b]).toBe(1);
    }
  });

  test('люк: с улицы — в канализацию и обратно', () => {
    const sim = makeSim(12345);
    const h = sim.map.hatches[0];
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', h.city.x, h.city.y);
    const use = sim.ctx.underground.hatchNear(c.x, c.y)!;
    expect(use).not.toBeNull();
    sim.ctx.underground.climb(c, use.to);
    expect(sim.map.levelAt(c.x, c.y)).toBe('sewer');
    expect(Math.hypot(c.x - h.sewer.x, c.y - h.sewer.y)).toBeLessThan(60);
    const back = sim.ctx.underground.hatchNear(c.x, c.y)!;
    sim.ctx.underground.climb(c, back.to);
    expect(sim.map.levelAt(c.x, c.y)).toBe('city');
  });
});

describe('сопротивление в городе', () => {
  test('саботаж: группа из убежища через люк выводит из строя узел, код жёлтый, потом отбой', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    // Только убежище, без городских патрулей, боёв на КПП и подкреплений из Цитадели (они идут через город).
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    sim.insurgency.populate();
    expect(sim.insurgency.garrison.length).toBeGreaterThan(0);
    expect(sim.insurgency.trader).not.toBeNull();
    const op = sim.insurgency.startOperation('sabotage')!;
    expect(op).not.toBeNull();
    const node = (op.team[0].brain as UndergroundBrain).node!;
    const t = run(sim, 150, () => node.broken);
    console.log(`узел саботирован через ${t.toFixed(0)} с (${op.where})`);
    expect(node.broken).toBe(true);
    expect(sim.war.code).not.toBe('green');
    expect(sim.log.some((l) => l.includes('Код ЖЁЛТЫЙ'))).toBe(true);
    // Группа уходит под землю, тревога снимается.
    run(sim, 180, () => sim.war.code === 'green' && op.team.every((c) => !c.alive || (c.brain as UndergroundBrain).mode === 'base'));
    for (const c of op.team) if (c.alive) expect(sim.map.levelAt(c.x, c.y)).toBe('sewer');
    expect(sim.war.code).toBe('green');
  });

  test('засада на патруль: нападение в городе поднимает тревогу, патрули стягиваются', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    run(sim, 5);
    const op = sim.insurgency.startOperation('ambush')!;
    expect(op).not.toBeNull();
    const t = run(sim, 150, () => sim.war.code !== 'green');
    console.log(`тревога через ${t.toFixed(0)} с после выхода засады (${op.where})`);
    expect(sim.war.code).not.toBe('green');
    const hunting = () => sim.entities.list.filter((c) => c.brain instanceof CpBrain && c.brain.fsm.current === 'hunt').length;
    run(sim, 20, () => hunting() > 0);
    expect(hunting()).toBeGreaterThan(0);
  });

  test('тревога: жёлтый код, отбой без нападавших через calmToGreen', () => {
    const sim = makeSim(12345);
    // Без отрядов у КПП (гарнизона в тесте нет — иначе будет прорыв и красный код).
    sim.war.command.paused = true;
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    sim.war.raiseAlarm(p.x, p.y, 'проверка');
    expect(sim.war.code).toBe('yellow');
    run(sim, ALARM.minTime + ALARM.calmToGreen + 2);
    expect(sim.war.code).toBe('green');
  });
});

describe('жизнь убежища', () => {
  test('партизаны ходят на вылазки: по тоннелям, на рынок, через люки в город — и возвращаются', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.insurgency.populate();
    sim.war.command.paused = true;
    let climbs = 0;
    const level = new Map<number, string>();
    for (let t = 0; t < 180 * 60; t++) {
      sim.step();
      for (const c of sim.insurgency.garrison) {
        const l = sim.map.levelAt(c.x, c.y);
        if (level.has(c.id) && level.get(c.id) !== l) climbs++;
        level.set(c.id, l);
      }
    }
    console.log(`вылазок: ${sim.insurgency.outings}, спусков и подъёмов по люкам: ${climbs}`);
    // Партизан в схроне трое (постоянный состав), люков два — у края города.
    expect(sim.insurgency.outings).toBeGreaterThan(5);
    expect(climbs).toBeGreaterThan(4);
    // В убежище всегда кто-то остаётся.
    expect(sim.insurgency.garrison.some((c) => sim.map.zoneAtWorld(c.x, c.y)?.kind === 'rebel_base' || sim.map.levelAt(c.x, c.y) === 'sewer')).toBe(true);
  });
});

describe('чёрный рынок', () => {
  test('покупка оружия, скупка рационов, поддельная CID снимает розыск', () => {
    const sim = makeSim(12345);
    const m = sim.insurgency.market!;
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', m.x, m.y, true);
    equipKit(c, 'citizen', sim.ctx);
    c.money = 200;
    const k = ECONOMY.blackMarket.stock.findIndex((s) => s.id === 'rebel_smg');
    expect(sim.economy.buyBlack(c, k)).toBeNull();
    expect(c.inventory.has('rebel_smg')).toBe(true);
    expect(c.money).toBe(200 - ECONOMY.blackMarket.stock[k].price);
    c.inventory.add('ration', 2);
    const before = c.money;
    expect(sim.economy.sellBlack(c, 'ration')).toBeNull();
    expect(c.money).toBe(before + ECONOMY.blackMarket.sell.ration!);
    expect(sim.economy.sellBlack(c, 'water')).not.toBeNull();
    c.money = 1;
    expect(sim.economy.buyBlack(c, 0)).not.toBeNull();
    c.law.wanted = true;
    c.inventory.add('fake_cid', 1);
    expect(sim.economy.use(c, 'fake_cid')).toBe(true);
    expect(c.law.wanted).toBe(false);
  });

  test('тайник: патроны к своим стволам, вещи не пропадают', () => {
    const sim = makeSim(12345);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'rebel', 100, 100);
    equipKit(c, 'rebel', sim.ctx);
    c.inventory.add('bread', 2);
    const smg = c.inventory.count('ammo_smg');
    expect(sim.economy.refillAmmo(c, 4)).toBeGreaterThan(0);
    expect(c.inventory.count('ammo_smg')).toBeGreaterThan(smg);
    expect(c.inventory.count('bread')).toBe(2);
  });
});
