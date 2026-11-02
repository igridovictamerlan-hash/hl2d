import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { AStar } from '../src/ai/AStar';
import type { Character } from '../src/entities/Character';
import type { DoorGroup } from '../src/systems/DoorSystem';

type Sim = ReturnType<typeof makeSim>;

function setup(seed = 12345): Sim {
  const sim = makeSim(seed);
  spawnPopulation(sim.ctx, 40);
  sim.war.command.paused = true;
  return sim;
}

/** Жилец с домом на замке и чужой житель. */
function pair(sim: Sim) {
  const L = sim.ctx.locks!;
  const civ = (c: Character) => c.alive && !c.isPlayer && c.faction === 'citizen' && c.home >= 0;
  const res = sim.entities.list.find((c) => civ(c) && L.keysOfHome(c.home).length > 0 && L.list[L.keysOfHome(c.home)[0]].kind === 'home')!;
  const lock = L.list[L.keysOfHome(res.home)[0]];
  const stranger = sim.entities.list.find((c) => civ(c) && !lock.homes.includes(c.home))!;
  return { L, res, lock, stranger, door: lock.doors[0] };
}

/** Точка за дверью: снаружи (sign = -1) или внутри (+1), на dist px от центра. */
const across = (g: DoorGroup, sign: number, dist: number) => ({ x: g.x + g.inside!.x * dist * sign, y: g.y + g.inside!.y * dist * sign });

/** Идти своими ногами к точке t секунд (без мозга). */
function walk(sim: Sim, c: Character, to: { x: number; y: number }, t: number): void {
  c.brain = null;
  for (let k = 0; k < t * 60; k++) {
    const d = Math.hypot(to.x - c.x, to.y - c.y);
    c.wantX = d > 2 ? ((to.x - c.x) / d) * 60 : 0;
    c.wantY = d > 2 ? ((to.y - c.y) / d) * 60 : 0;
    sim.step();
  }
}

const place = (c: Character, p: { x: number; y: number }) => {
  c.x = c.prevX = p.x;
  c.y = c.prevY = p.y;
  c.vx = c.vy = 0;
};

describe('двери и ключи', () => {
  test('замки: дома, комнаты коммуналок, лавки; ключи — по своему дому, ВС — служебной связкой', () => {
    const sim = setup();
    const { L, res, lock, stranger } = pair(sim);
    expect(L.list.filter((l) => l.kind === 'home').length).toBeGreaterThan(150);
    expect(L.list.filter((l) => l.kind === 'room').length).toBeGreaterThan(20);
    expect(L.list.filter((l) => l.kind === 'shop').length).toBeGreaterThanOrEqual(3);
    expect(L.list.every((l) => l.doors.length > 0)).toBe(true);
    expect(L.engaged(lock.id)).toBe(true);
    expect(L.can(res, lock.id)).toBe(true);
    expect(L.can(stranger, lock.id)).toBe(false);
    const cp = sim.entities.list.find((c) => c.alive && c.faction === 'cp')!;
    expect(L.can(cp, lock.id)).toBe(true);
    expect(L.blockerFor(cp)).toBeUndefined();
  });

  test('путь в чужой дом не строится, в свой — да; изнутри выйти может каждый', () => {
    const sim = setup();
    const { L, res, stranger, door } = pair(sim);
    const nav = sim.ctx.nav;
    const d = sim.ctx.housing.dwellings[res.home];
    const out = across(door, -1, 40);
    const start = nav.nearestWalkable(out.x, out.y);
    const goal = nav.nearestWalkable(d.at.x, d.at.y);
    const astar = new AStar(nav);
    expect(astar.find(start, goal, { blocked: L.blockerFor(res) })).not.toBeNull();
    expect(astar.find(start, goal, { blocked: L.blockerFor(stranger) })).toBeNull();
    expect(astar.find(goal, start, { blocked: L.blockerFor(stranger) })).not.toBeNull();
    // Позвали в гости — путь есть.
    L.invite(stranger, res);
    expect(astar.find(start, goal, { blocked: L.blockerFor(stranger) })).not.toBeNull();
  });

  test('у запертой двери чужой стоит, жилец открывает своим ключом и проходит, гость изнутри выходит', () => {
    const sim = setup();
    const { L, res, stranger, door } = pair(sim);
    // Все прочие — подальше от двери (никто не откроет).
    for (const c of sim.entities.list) if (c !== res && c !== stranger && Math.hypot(c.x - door.x, c.y - door.y) < 200) place(c, { x: 40, y: 40 });
    place(stranger, across(door, -1, 36));
    walk(sim, stranger, across(door, 1, 40), 4);
    expect(L.inside(stranger, door)).toBe(false);
    expect(door.closed).toBe(true);
    expect(door.barred).toBe(true);
    place(res, across(door, -1, 36));
    place(stranger, { x: 40, y: 60 });
    walk(sim, res, across(door, 1, 40), 4);
    expect(L.inside(res, door)).toBe(true);
    // Чужой внутри (впустили и ушли) — выходит сам.
    place(res, { x: 40, y: 80 });
    place(stranger, across(door, 1, 36));
    walk(sim, stranger, across(door, -1, 40), 4);
    expect(L.inside(stranger, door)).toBe(false);
    // Дверь снова закрыта на замок.
    walk(sim, stranger, across(door, -1, 120), 3);
    expect(door.barred).toBe(true);
  });

  test('выбитая дверь открыта до ремонта; хозяин может оставить незапертой', () => {
    const sim = setup();
    const { L, lock, door, stranger } = pair(sim);
    L.breakDoor(door);
    expect(L.engaged(lock.id)).toBe(false);
    for (let k = 0; k < 30; k++) sim.step();
    expect(door.closed).toBe(false);
    expect(L.canPass(stranger, door)).toBe(true);
    // Чинят через LOCKS.kick.repair с — сдвинем срок, а не ждём.
    lock.brokenUntil = sim.law.now + 0.2;
    for (let k = 0; k < 60; k++) sim.step();
    expect(door.broken).toBe(false);
    expect(L.engaged(lock.id)).toBe(true);
    L.setOpen(lock.id, true);
    expect(L.canPass(stranger, door)).toBe(true);
  });

  test('лавка заперта, пока продавца нет за прилавком', () => {
    const sim = setup();
    const L = sim.ctx.locks!;
    const shop = L.list.find((l) => l.kind === 'shop')!;
    const s = shop.shop!;
    const open = sim.ctx.shops.open(s);
    for (let k = 0; k < 40; k++) sim.step();
    expect(L.engaged(shop.id)).toBe(!sim.ctx.shops.open(s));
    void open;
    // Продавец — с ключом.
    if (s.vendor) expect(L.can(s.vendor, shop.id)).toBe(true);
  });
});
