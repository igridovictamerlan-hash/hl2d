import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { poiWorld, spawnPopulation } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { randomAnchorAround } from '../src/ai/destinations';
import { FISTS } from '../src/config/brawl';
import { LAW } from '../src/config/law';
import { CP_UNIT } from '../src/config/factions';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

/** Двое на площади лицом к лицу (без мозгов): a слева смотрит на b. */
function pair(sim: Sim, gap = 26): { a: Character; b: Character } {
  const p = poiWorld(sim.ctx, 'plaza_center')!;
  const a = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y);
  const b = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + gap, p.y);
  a.facing = 0;
  b.facing = Math.PI;
  sim.entities.rebuildHash();
  return { a, b };
}

/** Шаги мира на secs секунд. */
function run(sim: Sim, secs: number): void {
  for (let t = 0; t < Math.round(secs * 60); t++) sim.step();
}

/** Ждать, пока c сможет ударить (не дольше 2 с). */
function waitReady(sim: Sim, c: Character): void {
  for (let t = 0; t < 120 && !sim.combat.melee.ready(c); t++) sim.step();
}

/** Снова лицом к лицу вплотную (после отброса). */
function close(sim: Sim, a: Character, b: Character, gap = 26): void {
  b.x = b.prevX = a.x + gap;
  b.y = b.prevY = a.y;
  b.vx = b.vy = 0;
  a.facing = 0;
  b.facing = Math.PI;
  sim.entities.rebuildHash();
}

describe('ближний бой: удары и серии', () => {
  test('урон — после замаха; серия джеб → прямой → хук, хук отбрасывает, потом серия сначала', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    expect(sim.combat.punch(a, b.x, b.y)).toBe(b);
    expect(b.health).toBe(b.maxHealth);
    expect(a.melee.attack?.strike.name).toBe('джеб');
    run(sim, 0.12);
    expect(b.health).toBeLessThan(b.maxHealth);
    const names = ['джеб'];
    for (let k = 0; k < 2; k++) {
      waitReady(sim, a);
      close(sim, a, b);
      sim.combat.punch(a, b.x, b.y);
      names.push(a.melee.attack!.strike.name);
    }
    expect(names).toEqual(['джеб', 'прямой', 'хук']);
    // Хук — тяжёлый: отбрасывает заметно дальше джеба.
    const before = b.x - a.x;
    run(sim, 0.7);
    expect(b.x - a.x - before).toBeGreaterThan(12);
    expect(b.melee.struckAt).toBeGreaterThan(0);
    // После тяжёлого — снова с джеба.
    waitReady(sim, a);
    close(sim, a, b);
    sim.combat.punch(a, b.x, b.y);
    expect(a.melee.attack!.strike.name).toBe('джеб');
  });

  test('быстрый удар сбивает медленный замах', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    // a замахивается хуком (третий в серии), b успевает джебом — хук сорван, урона от a нет.
    a.melee.combo = 2;
    a.melee.comboUntil = sim.combat.now + 1;
    sim.combat.punch(a, b.x, b.y);
    expect(a.melee.attack!.strike.heavy).toBe(true);
    sim.combat.punch(b, a.x, a.y);
    run(sim, 0.35);
    expect(a.melee.attack!.broken).toBe(true);
    expect(a.health).toBeLessThan(a.maxHealth);
    expect(b.health).toBe(b.maxHealth);
    expect(sim.combat.melee.stats.interrupts).toBeGreaterThanOrEqual(1);
  });

  test('цель отшагнула в замахе: NPC не задевает прохожего, у игрока удар достаётся подвернувшемуся', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    const bystander = createCharacter(sim.entities, sim.ctx.rng, 'citizen', a.x + 60, a.y + 60);
    const swap = () => {
      // Цель ушла, на её месте — прохожий.
      b.x = b.prevX = a.x + 80;
      bystander.x = bystander.prevX = a.x + 27;
      bystander.y = bystander.prevY = a.y;
      sim.entities.rebuildHash();
    };
    expect(sim.combat.punch(a, b.x, b.y)).toBe(b);
    swap();
    run(sim, 0.15);
    expect(bystander.health).toBe(bystander.maxHealth);
    expect(sim.combat.melee.stats.whiffs).toBe(1);
    // Игрок бьёт того, кто перед ним.
    // Игрок — на месте a (a отошёл далеко).
    const p = createCharacter(sim.entities, sim.ctx.rng, 'citizen', a.x, a.y, true);
    a.y = a.prevY = a.y - 200;
    b.x = b.prevX = p.x + 27;
    b.y = b.prevY = p.y;
    sim.entities.rebuildHash();
    run(sim, 0.5);
    b.x = b.prevX = p.x + 27;
    b.y = b.prevY = p.y;
    sim.entities.rebuildHash();
    expect(sim.combat.punch(p, b.x, b.y)).toBe(b);
    b.x = b.prevX = p.x + 80;
    bystander.x = bystander.prevX = p.x + 27;
    bystander.y = bystander.prevY = p.y;
    sim.entities.rebuildHash();
    run(sim, 0.15);
    expect(bystander.health).toBeLessThan(bystander.maxHealth);
  });

  test('нажатый в отходе удар выходит сам (серия без провалов)', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    sim.combat.punch(a, b.x, b.y);
    // Удар нанесён, идёт отход — до конца меньше буфера.
    while (!(a.melee.attack!.done && a.nextShot - sim.combat.now < 0.15)) sim.step();
    expect(sim.combat.punch(a, b.x, b.y)).toBeNull();
    run(sim, 0.2);
    expect(sim.combat.melee.stats.attacks).toBe(2);
    expect(a.melee.attack!.step).toBe(1);
  });
});

describe('ближний бой: блок, парирование, нокаут', () => {
  test('блок держит удар; вовремя — парирование сбивает бьющего; тяжёлый пробивает блок', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    // Блок поднят заранее — обычный блок: урон намного меньше.
    expect(sim.combat.melee.guard(b, true)).toBe(true);
    run(sim, 0.3);
    sim.combat.punch(a, b.x, b.y);
    run(sim, 0.15);
    const blocked = b.maxHealth - b.health;
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(3);
    expect(sim.combat.fx.some((f) => f.kind === 'block' && f.target === b)).toBe(true);
    // Блок поднят в замахе противника — парирование: урона нет, бьющий сбит.
    sim.combat.melee.guard(b, false);
    waitReady(sim, a);
    close(sim, a, b);
    const hp = b.health;
    sim.combat.punch(a, b.x, b.y);
    sim.step();
    sim.combat.melee.guard(b, true);
    run(sim, 0.15);
    expect(b.health).toBe(hp);
    expect(sim.combat.melee.stats.parries).toBe(1);
    expect(a.melee.stagger).toBeGreaterThan(sim.combat.now);
    // Тяжёлый удар (хук) пробивает блок: закрыться какое-то время нельзя.
    waitReady(sim, a);
    for (let t = 0; t < 120 && a.melee.stagger > sim.combat.now; t++) sim.step();
    close(sim, a, b);
    run(sim, 0.3);
    a.melee.combo = 2;
    a.melee.comboUntil = sim.combat.now + 1;
    sim.combat.punch(a, b.x, b.y);
    run(sim, 0.3);
    expect(sim.combat.melee.stats.breaks).toBe(1);
    expect(b.melee.block).toBe(false);
    expect(sim.combat.melee.guard(b, true)).toBe(false);
  });

  test('кулаком не убить: нокаут — лежит, не бьёт и не закрывается, потом встаёт', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    b.health = FISTS.floor + 3;
    sim.combat.punch(a, b.x, b.y);
    run(sim, 0.15);
    expect(b.alive).toBe(true);
    expect(b.health).toBeGreaterThanOrEqual(FISTS.floor - 0.01);
    expect(sim.combat.knockedOut(b)).toBe(true);
    expect(b.speedMul).toBe(0);
    expect(sim.combat.melee.guard(b, true)).toBe(false);
    expect(sim.combat.punch(b, a.x, a.y)).toBeNull();
    expect(b.melee.attack).toBeNull();
    // Лежачего кулаком не бьют.
    waitReady(sim, a);
    expect(sim.combat.punch(a, b.x, b.y)).toBeNull();
    run(sim, FISTS.knockout);
    expect(sim.combat.knockedOut(b)).toBe(false);
  });

  test('нож: голыми руками от ножа — порез по рукам (кровит), но меньше, чем без блока', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    a.inventory.add('knife', 1);
    sim.combat.equip(a, 'knife');
    run(sim, 0.3);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', a.x, a.y + 60);
    c.facing = Math.PI;
    // Без блока.
    const k = createCharacter(sim.entities, sim.ctx.rng, 'citizen', c.x - 26, c.y);
    k.inventory.add('knife', 1);
    sim.combat.equip(k, 'knife');
    k.facing = 0;
    sim.entities.rebuildHash();
    run(sim, 0.3);
    sim.combat.fire(k, c.x, c.y);
    run(sim, 0.15);
    const open = c.maxHealth - c.health;
    // В блоке голыми руками.
    sim.combat.melee.guard(b, true);
    run(sim, 0.3);
    sim.combat.fire(a, b.x, b.y);
    run(sim, 0.15);
    const guarded = b.maxHealth - b.health;
    expect(guarded).toBeGreaterThan(0);
    expect(guarded).toBeLessThan(open);
    expect(b.lastZone).toBe('arm');
    expect(b.bleed).toBeGreaterThan(0);
  });

  test('выпад и отброс — не бег: ВС рядом не считает это нарушением', () => {
    const sim = makeSim(12345);
    const { a, b } = pair(sim);
    const cp = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, { x: a.x + 13, y: a.y - 70 })!;
    cp.brain = null;
    cp.facing = Math.PI / 2;
    a.melee.combo = 2;
    a.melee.comboUntil = sim.combat.now + 1;
    sim.combat.punch(a, b.x, b.y);
    let fast = 0;
    let running = 0;
    for (let t = 0; t < 40; t++) {
      sim.step();
      if (b.moveSpeed > LAW.runSpeed) {
        fast++;
        if (sim.law.observe(cp, b) === 'running') running++;
      }
    }
    expect(fast).toBeGreaterThan(0);
    expect(running).toBe(0);
  });
});

describe('ближний бой: драка NPC', () => {
  test('жители в драке обходят друг друга, закрываются и бьют сериями; никто не гибнет', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 40);
    const cits = sim.entities.list.filter((c) => c.faction === 'citizen' && c.gang < 0 && c.brain instanceof CitizenBrain && c.loyalty < 60);
    const [a, b] = cits;
    // Без ВС: иначе патруль разнимает драку (свой тест — brawl.test).
    for (const c of sim.entities.list) if (c.faction === 'cp') c.brain = null;
    const n = randomAnchorAround(a, sim.ctx, 1, 2, new Set());
    b.x = b.prevX = sim.nav.worldX(n);
    b.y = b.prevY = sim.nav.worldY(n);
    a.law.lastCheck = b.law.lastCheck = sim.law.now;
    expect(sim.ctx.brawls.start(a, b)).toBe(true);
    const st = sim.combat.melee.stats;
    let path = 0;
    let px = a.x;
    let py = a.y;
    for (let t = 0; t < 20 * 60 && sim.ctx.brawls.fighting(a); t++) {
      sim.step();
      path += Math.hypot(a.x - px, a.y - py);
      px = a.x;
      py = a.y;
    }
    expect(st.attacks).toBeGreaterThan(6);
    expect(st.hits).toBeGreaterThan(2);
    // Не машут на месте: закрываются или отшагивают — есть блоки и промахи, и ходят по кругу.
    expect(st.blocks + st.whiffs).toBeGreaterThan(0);
    expect(path).toBeGreaterThan(60);
    expect(a.alive && b.alive).toBe(true);
    expect(Math.min(a.health, b.health)).toBeGreaterThanOrEqual(FISTS.floor - 0.01);
  });
});
