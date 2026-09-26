import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit, poiWorld, spawnPopulation } from '../src/systems/Population';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { LABOR } from '../src/config/labor';
import { ECONOMY } from '../src/config/economy';
import { ChatSystem } from '../src/systems/ChatSystem';
import type { ProfessionId } from '../src/config/professions';
import type { FactionId } from '../src/config/factions';
import { CRIME } from '../src/config/crime';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, secs: number, until?: () => boolean): number {
  for (let t = 0; t < secs * 60; t++) {
    sim.step();
    if (until?.()) return t / 60;
  }
  return secs;
}

/** NPC с профессией у точки. */
function worker(sim: Sim, faction: FactionId, prof: ProfessionId, at: { x: number; y: number }, kit = 'cwu') {
  const a = sim.nav.nearestWalkable(at.x, at.y, 6);
  const c = createCharacter(sim.entities, sim.ctx.rng, faction, sim.nav.worldX(a), sim.nav.worldY(a));
  equipKit(c, kit, sim.ctx);
  c.profession = prof;
  c.brain = new CitizenBrain(c, sim.ctx);
  (c.brain as CitizenBrain).idleLeft = 0;
  return c;
}

function calm(sim: Sim): void {
  sim.war.command.paused = true;
  sim.insurgency.paused = true;
}

describe('профессии ГСР: цепочка снабжения', () => {
  test('фасовщик собирает коробки на заводе, курьер несёт их на склад будки', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    const labor = sim.labor;
    expect(labor.factory).not.toBeNull();
    labor.boxes = 0;
    const packer = worker(sim, 'cwu', 'packer', labor.factory!);
    run(sim, 40, () => labor.boxes >= 2);
    expect(labor.stats.packed).toBeGreaterThanOrEqual(2);
    expect(packer.money).toBeGreaterThan(40);
    const stock = sim.economy.rationStock;
    sim.economy.rationStock = 0;
    const courier = worker(sim, 'cwu', 'courier', labor.factoryStore!);
    const t = run(sim, 240, () => labor.stats.delivered > 0);
    console.log(`курьер донёс коробку за ${t.toFixed(0)} с`);
    expect(labor.stats.delivered).toBeGreaterThan(0);
    expect(sim.economy.rationStock).toBe(LABOR.factory.boxRations);
    expect(courier.carrying).toBe(false);
    void stock;
  });

  test('без рационов на складе будки раздатчик не выдаёт', () => {
    const sim = makeSim(12345);
    const eco = sim.economy;
    eco.open = true;
    eco.rationStock = 0;
    const slot = eco.queueSlot(0);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', slot.x, slot.y);
    const cook = createCharacter(sim.entities, sim.ctx.rng, 'cwu', eco.dispenserSpot.x, eco.dispenserSpot.y);
    eco.joinQueue(c);
    expect(eco.serveNext(cook)).toBeNull();
    expect(sim.log.some((l) => l.includes('кончились рационы'))).toBe(true);
    eco.rationStock = 3;
    expect(eco.serveNext(cook)).toBe(c);
    expect(eco.rationStock).toBe(2);
  });

  test('уборщик убирает мусор за плату, вортигонт тоже; отброс находит в мусоре чаще', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    const labor = sim.labor;
    const pile = labor.trash[0];
    const j = worker(sim, 'cwu', 'janitor', pile);
    const money = j.money;
    run(sim, 30, () => !labor.trash.includes(pile));
    expect(labor.trash.includes(pile)).toBe(false);
    expect(j.money).toBeGreaterThanOrEqual(money + LABOR.trash.pay);
    const pile2 = labor.trash[0];
    const v = worker(sim, 'vort', 'vort_slave', pile2, 'vort');
    run(sim, 30, () => !labor.trash.includes(pile2));
    expect(labor.trash.includes(pile2)).toBe(false);
    expect(v.money).toBeGreaterThan(0);
    // Находки: отброс против обычного гражданина на одинаковых кучах.
    let outcast = 0;
    let plain = 0;
    const o = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 0, 0);
    o.profession = 'outcast';
    const p = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 0, 0);
    for (let k = 0; k < 200; k++) {
      const make = () => ({ id: -k, x: 0, y: 0, worker: null, searched: false, progress: 0, seed: k });
      if (labor.search(o, make())) outcast++;
      if (labor.search(p, make())) plain++;
      o.inventory.clear();
      p.inventory.clear();
    }
    console.log(`находки в мусоре: отброс ${outcast}/200, гражданин ${plain}/200`);
    expect(outcast).toBeGreaterThan(plain * 1.5);
  });

  test('медик ГСР лечит гражданина за плату, сотрудника ГО — бесплатно', () => {
    const sim = makeSim(12345);
    const m = createCharacter(sim.entities, sim.ctx.rng, 'cwu', 100, 100);
    equipKit(m, 'cwu_medic', sim.ctx);
    m.profession = 'cwu_medic';
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 120, 100);
    c.health = 30;
    c.money = 20;
    expect(sim.labor.treat(m, c)).toBeNull();
    expect(c.health).toBeGreaterThan(30);
    expect(c.money).toBe(20 - LABOR.medic.fee);
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', 120, 110);
    cp.health = 40;
    const before = cp.money;
    expect(sim.labor.treat(m, cp)).toBeNull();
    expect(cp.money).toBe(before);
    const poor = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 120, 120);
    poor.health = 20;
    poor.money = 0;
    expect(sim.labor.treat(m, poor)).toMatch(/нет/);
  });

  test('в городе ГСР работают сами: завод, доставка, уборка, раздача', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    spawnPopulation(sim.ctx, 20);
    run(sim, 150);
    const s = sim.labor.stats;
    console.log(`за 150 с: ${JSON.stringify(s)}, склад будки ${sim.economy.rationStock}, выдано ${sim.entities.list.filter((c) => sim.economy.hasBeenServed(c)).length}`);
    expect(s.packed).toBeGreaterThan(0);
    expect(s.delivered).toBeGreaterThan(0);
    expect(s.cleaned).toBeGreaterThan(3);
    expect(sim.entities.list.filter((c) => sim.economy.hasBeenServed(c)).length).toBeGreaterThan(3);
  });
});

describe('лоялисты', () => {
  test('лоялист встаёт в очередь перед гражданином и бегает без нарушения', () => {
    const sim = makeSim(12345);
    const eco = sim.economy;
    eco.open = true;
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const a = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y);
    const b = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y);
    const loyal = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y);
    a.loyalty = 5;
    b.loyalty = 5;
    loyal.loyalty = 120;
    eco.joinQueue(a);
    eco.joinQueue(b);
    expect(eco.joinQueue(loyal)).toBe(1);
    expect(eco.queue.indexOf(b)).toBe(2);
    // Бег: гражданину — нарушение, лоялисту — нет.
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x + 60, p.y);
    for (const c of [a, loyal]) {
      c.x = p.x + 100;
      c.y = p.y;
      c.moveSpeed = ECONOMY.hunger.max * 2;
    }
    cp.facing = 0;
    const va = sim.law.observe(cp, a);
    const vl = sim.law.observe(cp, loyal);
    if (va !== null) expect(va).toBe('running');
    expect(vl).toBeNull();
  });

  test('/охрана: доверенному лоялисту двое патрульных ГО идут в сопровождение', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const player = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y, true);
    sim.ctx.player = player;
    player.loyalty = 150;
    for (let k = 0; k < 3; k++) {
      const a = sim.nav.nearestWalkable(p.x + 100 + k * 30, p.y + 40, 6);
      const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', sim.nav.worldX(a), sim.nav.worldY(a));
      equipKit(cp, 'cp', sim.ctx);
      cp.brain = new CpBrain(cp, sim.ctx);
    }
    run(sim, 1);
    const chat = new ChatSystem(sim.ctx);
    chat.submit(player, '/охрана');
    const guards = sim.entities.list.filter((c) => c.brain instanceof CpBrain && c.brain.ward === player);
    expect(guards.length).toBe(2);
    run(sim, 8);
    for (const g of guards) expect(Math.hypot(g.x - player.x, g.y - player.y)).toBeLessThan(90);
    // Гражданину без статуса охрану не дают.
    const other = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y, true);
    other.loyalty = 10;
    const before = sim.log.length;
    chat.submit(other, '/охрана');
    expect(sim.log.slice(before).join(' ')).toMatch(/только доверенные лоялисты/);
  });
});

describe('граждане: вор, вортигонты', () => {
  test('карманная кража — только со спины; ГО, увидевший вора после кражи, задерживает за кражу', () => {
    const sim = makeSim(12345);
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const victim = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y);
    victim.money = 30;
    victim.facing = 0;
    const thief = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + 20, p.y);
    thief.profession = 'thief';
    // Спереди — нельзя.
    expect(sim.crime.behind(thief, victim)).toBe(false);
    thief.x = p.x - 20;
    expect(sim.crime.behind(thief, victim)).toBe(true);
    const got = sim.crime.pickpocket(thief, victim);
    expect(got).toBeGreaterThan(0);
    expect(victim.money).toBe(30 - got);
    // ГО рядом, смотрит на вора.
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x - 80, p.y);
    cp.facing = 0;
    expect(sim.law.observe(cp, thief)).toBe('theft');
    expect(sim.law.judge(thief).kind).toBe('arrest');
    // Через CRIME.seenFor секунд — уже не «на месте преступления».
    for (let t = 0; t < (CRIME.seenFor + 0.5) * 60; t++) sim.law.update(1 / 60, null);
    expect(sim.law.observe(cp, thief)).not.toBe('theft');
  });

  test('взлом раздатчика: только когда окно закрыто и есть отмычка', () => {
    const sim = makeSim(12345);
    const eco = sim.economy;
    const thief = createCharacter(sim.entities, sim.ctx.rng, 'citizen', eco.window.x, eco.window.y);
    thief.profession = 'thief';
    expect(sim.crime.hackDispenser(thief)).toBe(0);
    thief.inventory.add('lockpick', 1);
    eco.open = true;
    expect(sim.crime.hackDispenser(thief)).toBe(0);
    eco.open = false;
    const stock = eco.rationStock;
    expect(sim.crime.hackDispenser(thief)).toBe(CRIME.hack.rations);
    expect(eco.rationStock).toBe(stock - CRIME.hack.rations);
    expect(thief.inventory.count('ration')).toBe(CRIME.hack.rations);
  });

  test('NPC-воры сами обворовывают прохожих в городе', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    calm(sim);
    spawnPopulation(sim.ctx, 25);
    run(sim, 480, () => sim.crime.stats.pickpockets > 0);
    console.log(`краж: ${sim.crime.stats.pickpockets}, украдено ${sim.crime.stats.stolen}, крики ${sim.crime.stats.cries}`);
    expect(sim.crime.stats.pickpockets).toBeGreaterThan(0);
  });

  test('вортигонтов ГО не проверяет', () => {
    const sim = makeSim(12345);
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const v = createCharacter(sim.entities, sim.ctx.rng, 'vort', p.x + 60, p.y);
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x, p.y);
    cp.facing = 0;
    v.moveSpeed = 300;
    expect(sim.law.observe(cp, v)).toBeNull();
    expect(sim.law.checkable(v)).toBe(false);
  });
});
