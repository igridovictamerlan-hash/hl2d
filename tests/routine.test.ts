import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CitizenBrain } from '../src/ai/brains/CitizenBrain';
import { LIGHTING } from '../src/config/lighting';
import { CP_UNIT } from '../src/config/factions';
import { randomAnchorAround } from '../src/ai/destinations';
import type { Character } from '../src/entities/Character';

/** Игровое время, при котором на часах hour (сутки — LIGHTING.dayLength, начало — LIGHTING.start). */
const timeAt = (hour: number): number => {
  let f = hour / 24 - LIGHTING.start;
  if (f < 0) f += 1;
  return f * LIGHTING.dayLength;
};

describe('распорядок дня', () => {
  test('фазы суток по часам; у жителя свой сдвиг; смены и раздача — днём', () => {
    const sim = makeSim(12345);
    const R = sim.ctx.routine;
    R.enabled = true;
    sim.ctx.time = timeAt(3);
    expect(R.phase()).toBe('night');
    expect(R.rationsHours()).toBe(false);
    sim.ctx.time = timeAt(7.5);
    expect(R.phase()).toBe('morning');
    sim.ctx.time = timeAt(13);
    expect(R.phase()).toBe('day');
    expect(R.rationsHours()).toBe(true);
    sim.ctx.time = timeAt(20);
    expect(R.phase()).toBe('evening');
  });

  test('ночью горожане идут домой спать, утром выходят', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 40);
    sim.ctx.routine.enabled = true;
    // Ночь: 0:30 — время сна у всех (кроме сов и тех, кто живёт ночью).
    sim.ctx.time = timeAt(0.5);
    const townsfolk = (): Character[] =>
      sim.entities.list.filter((c) => c.alive && c.faction === 'citizen' && c.gang < 0 && c.profession === 'citizen' && c.brain instanceof CitizenBrain);
    for (let t = 0; t < 90 * 60; t++) sim.step();
    const night = townsfolk();
    const home = night.filter((c) => (c.brain as CitizenBrain).fsm.current === 'home');
    expect(night.length).toBeGreaterThan(5);
    expect(home.length / night.length).toBeGreaterThan(0.5);
    // Утро: время сна кончилось — выходят из домов.
    sim.ctx.time = timeAt(9.5);
    for (let t = 0; t < 60 * 60; t++) sim.step();
    const morning = townsfolk().filter((c) => (c.brain as CitizenBrain).fsm.current === 'home');
    expect(morning.length).toBeLessThan(home.length);
  });

  test('поручение: посылка с доски — по адресу за плату; свёрток — контрабанда на проверке', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 40);
    const E = sim.ctx.errands;
    const board = sim.ctx.street.boards[0];
    expect(board).toBeTruthy();
    const p = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen' }, board.stand)!;
    p.loyalty = 60;
    let msg = '';
    for (let k = 0; k < 20 && !E.active; k++) msg = E.take(p, board);
    expect(E.active).toBeTruthy();
    expect(msg.length).toBeGreaterThan(0);
    const a = E.active!;
    expect(p.inventory.has(a.secret ? 'parcel_x' : 'parcel')).toBe(true);
    // Не у дома — не сдать; у дома — плата.
    expect(E.deliver(p)).toBeNull();
    p.x = a.to.at.x;
    p.y = a.to.at.y;
    const money = p.money;
    expect(E.deliver(p)).toBeTruthy();
    expect(p.money).toBeGreaterThan(money);
    expect(E.active).toBeNull();
    // Свёрток подполья при проверке CID — арест за контрабанду (находят с шансом).
    let found = false;
    for (let k = 0; k < 30 && !found; k++) {
      p.inventory.add('parcel_x', 1);
      p.law.reason = 'routine';
      found = sim.law.judge(p).reason === 'contraband';
    }
    expect(found).toBe(true);
  });

  test('ГО: стрелявший в городе — вооружённый враг (огонь, розыск, тревога)', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 10);
    const a = randomAnchorAround({ x: sim.ctx.street.plaza!.x, y: sim.ctx.street.plaza!.y }, sim.ctx, 2, 6, new Set());
    const cp = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, { x: sim.nav.worldX(a), y: sim.nav.worldY(a) })!;
    const b = randomAnchorAround(cp, sim.ctx, 3, 5, new Set());
    const g = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'bandit', division: null, rank: 0, kit: 'bandit' }, { x: sim.nav.worldX(b), y: sim.nav.worldY(b) })!;
    g.inventory.add('rebel_pistol', 1);
    let hostile = false;
    for (let t = 0; t < 20 * 60 && !hostile; t++) {
      // Держит ствол в руках и «только что стрелял», стоит на виду у патрульного.
      g.weapon = 'rebel_pistol';
      g.lastFired = sim.law.now;
      g.wantX = g.wantY = 0;
      cp.facing = Math.atan2(g.y - cp.y, g.x - cp.x);
      sim.step();
      hostile = g.hostile;
    }
    expect(hostile).toBe(true);
    expect(g.law.wanted).toBe(true);
    expect(sim.log.some((l) => l.includes('стрельба в городе'))).toBe(true);
  });
});
